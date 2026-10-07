// The page's audio graph: one source (a generated loop, a file or the microphone) played
// through whichever plugin is active, with a latency-matched dry path for A/B.
//
//   source -> input -+-> preAnalyser
//                    +-> dryDelay -> dry --+
//                    +-> plugin node -> wet +-> output -> postAnalyser
//                                                      -> master -> speakers

import { WewEffect } from './wew-effect.js';

export const SOURCES = [
    { id: 'drums', label: 'Drum loop' },
    { id: 'chords', label: 'Chords' },
    { id: 'bass', label: 'Reese bass' },
    { id: 'glide', label: 'Glide (off-key)' },
    { id: 'noise', label: 'Pink noise' },
    { id: 'file', label: 'Your file…' },
    { id: 'mic', label: 'Microphone' },
];

export class Engine {
    constructor() {
        this.ctx = null;
        this.effects = new Map(); // slug -> Promise<WewEffect>
        this.active = null; // slug
        this.activeFx = null;
        this.sourceId = 'drums';
        this.buffers = new Map(); // source id -> AudioBuffer
        this.fileBuffer = null;
        this.fileName = '';
        this.playing = false;
        this.bypassed = false;
        this.listeners = new Set();
        this.node = null; // current source node
        this.micStream = null;
    }

    on(fn) { this.listeners.add(fn); }
    emit() { this.listeners.forEach((fn) => fn(this)); }

    // Builds the graph. The AudioContext starts suspended until start() runs from a click.
    init() {
        if (this.ctx) return;
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.input = ctx.createGain();
        this.output = ctx.createGain();
        this.master = ctx.createGain();
        this.master.gain.value = 0.8;
        this.dryDelay = ctx.createDelay(1);
        this.dry = ctx.createGain();
        this.wet = ctx.createGain();
        this.dry.gain.value = 0;
        this.preAnalyser = ctx.createAnalyser();
        this.postAnalyser = ctx.createAnalyser();
        for (const a of [this.preAnalyser, this.postAnalyser]) {
            a.fftSize = 8192;
            a.smoothingTimeConstant = 0;
        }
        this.input.connect(this.preAnalyser);
        this.input.connect(this.dryDelay).connect(this.dry).connect(this.output);
        this.wet.connect(this.output);
        this.output.connect(this.postAnalyser);
        this.output.connect(this.master).connect(ctx.destination);
    }

    // Resumes audio; must run from a user gesture.
    async start() {
        // iOS mutes Web Audio under the silent switch unless the page is a playback session
        // (Safari 17+), the way video and music apps are.
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
        this.init();
        if (this.ctx.state !== 'running') await this.ctx.resume();
    }

    effect(slug) {
        this.init();
        if (!this.effects.has(slug)) this.effects.set(slug, WewEffect.create(this.ctx, `wasm/${slug}.wasm`));
        return this.effects.get(slug);
    }

    // Routes the source through `slug`'s plugin.
    async activate(slug) {
        await this.start();
        const fx = await this.effect(slug);
        if (this.activeFx && this.activeFx !== fx) {
            this.input.disconnect(this.activeFx.node);
            this.activeFx.node.disconnect();
        }
        if (this.activeFx !== fx) {
            this.input.connect(fx.node);
            fx.node.connect(this.wet);
            fx.onlatency = () => this.#matchLatency();
            fx.reset();
        }
        this.active = slug;
        this.activeFx = fx;
        this.#matchLatency();
        this.emit();
        return fx;
    }

    #matchLatency() {
        if (this.activeFx) this.dryDelay.delayTime.value = this.activeFx.latency / this.ctx.sampleRate;
    }

    setBypass(on) {
        this.bypassed = on;
        if (this.ctx) {
            const t = this.ctx.currentTime;
            this.dry.gain.setTargetAtTime(on ? 1 : 0, t, 0.015);
            this.wet.gain.setTargetAtTime(on ? 0 : 1, t, 0.015);
        }
        this.emit();
    }

    setVolume(v) {
        if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    async setSource(id) {
        this.sourceId = id;
        if (this.playing) await this.play();
        this.emit();
    }

    async loadFile(file) {
        await this.start();
        this.fileBuffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
        this.fileName = file.name;
        this.sourceId = 'file';
        await this.play();
    }

    async play() {
        await this.start();
        this.#stopSource();
        if (this.sourceId === 'mic') {
            this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            });
            this.node = this.ctx.createMediaStreamSource(this.micStream);
        } else {
            const buf = this.sourceId === 'file' ? this.fileBuffer : await this.#generated(this.sourceId);
            if (!buf) return false;
            const n = this.ctx.createBufferSource();
            n.buffer = buf;
            n.loop = true;
            n.start();
            this.node = n;
        }
        this.node.connect(this.input);
        this.playing = true;
        this.emit();
        return true;
    }

    stop() {
        this.#stopSource();
        this.playing = false;
        this.emit();
    }

    #stopSource() {
        if (this.node) {
            if (this.node.stop) this.node.stop();
            this.node.disconnect();
            this.node = null;
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach((t) => t.stop());
            this.micStream = null;
        }
    }

    async #generated(id) {
        if (!this.buffers.has(id)) this.buffers.set(id, render(id, this.ctx.sampleRate));
        return this.buffers.get(id);
    }
}

// ---- Generated test loops (rendered once per page with an OfflineAudioContext) ----

const BPM = 112;
const BEAT = 60 / BPM;
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuffer(ctx, seconds, pink = false) {
    const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const w = seed / 2147483648 - 1;
        if (!pink) {
            d[i] = w;
            continue;
        }
        // Paul Kellet's pink filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
    }
    return buf;
}

function kick(ctx, t, out) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.5);
}

function snare(ctx, t, out, noise, level = 0.7) {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise;
    f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.7;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random() * 0.5, 0.3);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    og.gain.setValueAtTime(level * 0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.15);
}

function hat(ctx, t, out, noise, open = false) {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise;
    f.type = 'highpass'; f.frequency.value = 7500;
    const len = open ? 0.25 : 0.05;
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random() * 0.5, len + 0.02);
}

// Detuned saw voice with a lowpass envelope.
function saws(ctx, t, dur, hz, out, { detune = 12, voices = 3, cutoff = 2400, level = 0.12, attack = 0.02 } = {}) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(cutoff * 0.4, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + Math.min(0.3, dur));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + dur - 0.08);
    g.gain.linearRampToValueAtTime(0, t + dur);
    f.connect(g).connect(out);
    for (let v = 0; v < voices; v++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz;
        o.detune.value = voices > 1 ? (v / (voices - 1) - 0.5) * 2 * detune : 0;
        o.connect(f);
        o.start(t);
        o.stop(t + dur);
    }
}

async function render(id, rate) {
    const bars = id === 'drums' ? 2 : 4;
    const seconds = id === 'noise' ? 4 : id === 'glide' ? 8 : bars * 4 * BEAT;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    const noise = noiseBuffer(ctx, 1);

    if (id === 'drums') {
        // Two bars of a broken beat, sixteenth-note grid
        const K = 'x.........x.....x.x.......x.....';
        const S = '....x.......x..x....x.......x...';
        const H = 'x.x.x.x.x.x.xox.x.x.x.x.x.x.x.xo';
        const step = BEAT / 4;
        for (let i = 0; i < 32; i++) {
            const t = i * step;
            if (K[i] === 'x') kick(ctx, t, bus);
            if (S[i] === 'x') snare(ctx, t, bus, noise, i % 8 === 7 ? 0.35 : 0.7);
            if (H[i] !== '.') hat(ctx, t, bus, noise, H[i] === 'o');
        }
    } else if (id === 'chords') {
        // Cmaj9 – Am9 – Fmaj7#11 – G6, one bar each
        const chords = [[48, 55, 59, 62, 64], [45, 52, 55, 59, 60], [41, 48, 52, 55, 59], [43, 50, 52, 55, 59]];
        chords.forEach((c, i) => c.forEach((m) => saws(ctx, i * 4 * BEAT, 4 * BEAT, midiHz(m), bus, { level: 0.07, attack: 0.15, cutoff: 1800 })));
        // and a plucky top line
        const line = [72, 74, 76, 79, 76, 74, 72, 71, 69, 72, 76, 74, 72, 71, 67, 71];
        line.forEach((m, i) => saws(ctx, i * BEAT, BEAT * 0.9, midiHz(m), bus, { voices: 1, level: 0.06, cutoff: 3500, attack: 0.005 }));
    } else if (id === 'bass') {
        const notes = [36, 36, 33, 33, 29, 29, 31, 31];
        notes.forEach((m, i) => saws(ctx, i * 2 * BEAT, 2 * BEAT, midiHz(m), bus, { detune: 22, voices: 2, cutoff: 900, level: 0.35 }));
        for (let i = 0; i < 16; i++) kick(ctx, i * BEAT, bus);
    } else if (id === 'glide') {
        // A saw and a sine sliding smoothly up and back: every frequency in between is off-key.
        const o = ctx.createOscillator(), s = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth';
        f.type = 'lowpass'; f.frequency.value = 3000;
        for (const osc of [o, s]) {
            osc.frequency.setValueAtTime(110, 0);
            osc.frequency.exponentialRampToValueAtTime(440, seconds / 2);
            osc.frequency.exponentialRampToValueAtTime(110, seconds);
        }
        g.gain.value = 0.18;
        o.connect(f).connect(g).connect(bus);
        s.connect(g);
        o.start(0); s.start(0);
    } else if (id === 'noise') {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx, seconds, true);
        n.connect(bus);
        n.start(0);
    }
    return ctx.startRendering();
}
