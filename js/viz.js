// Canvas visualizers for the editors and the hero, fed by the engine's analysers.

const PLATINUM = '#cdd0da';
const DIM = 'rgba(180,180,188,0.35)';
const GRID = 'rgba(255,255,255,0.06)';
const F_LO = 30, F_HI = 16000;

// Per-frame analyser readings shared by every visualizer.
export class Spectra {
    constructor(engine) {
        this.engine = engine;
        this.pre = null;
        this.post = null;
        this.frameId = -1;
        this.level = 0; // smoothed output level, 0..1
    }

    update(frameId) {
        if (frameId === this.frameId) return;
        this.frameId = frameId;
        const e = this.engine;
        if (!e.ctx) return;
        if (!this.pre) {
            this.pre = new Float32Array(e.preAnalyser.frequencyBinCount);
            this.post = new Float32Array(e.postAnalyser.frequencyBinCount);
            this.time = new Float32Array(e.postAnalyser.fftSize);
            this.rate = e.ctx.sampleRate;
        }
        e.preAnalyser.getFloatFrequencyData(this.pre);
        e.postAnalyser.getFloatFrequencyData(this.post);
        e.postAnalyser.getFloatTimeDomainData(this.time);
        let sum = 0;
        for (let i = 0; i < this.time.length; i += 4) sum += this.time[i] * this.time[i];
        const rms = Math.sqrt(sum / (this.time.length / 4));
        this.rms = rms;
        const l = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) / 54));
        this.level += (l - this.level) * (l > this.level ? 0.5 : 0.08);
    }

    get live() { return !!this.pre && this.engine.playing; }

    // Mean power (dB) of `data` between f0 and f1.
    band(data, f0, f1) {
        const hz = this.rate / 2 / data.length;
        let i0 = Math.max(1, Math.floor(f0 / hz)), i1 = Math.min(data.length - 1, Math.ceil(f1 / hz));
        if (i1 < i0) i1 = i0;
        let p = 0;
        for (let i = i0; i <= i1; i++) p += Math.pow(10, data[i] / 10);
        return 10 * Math.log10(p / (i1 - i0 + 1) + 1e-20);
    }
}

export function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
}

const xOfF = (f, w) => (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * w;
const fOfX = (x, w) => F_LO * Math.pow(F_HI / F_LO, x / w);

// ---- Spectrum: dry (platinum) and processed (accent), like Keyfield's DRY / TUNED display ----

export class SpectrumViz {
    constructor(canvas, spectra, accent, { keyMask = null, labels = ['DRY', 'WET'] } = {}) {
        Object.assign(this, { canvas, spectra, accent, keyMask, labels });
        this.cols = 96;
        this.dry = new Float32Array(this.cols).fill(0);
        this.wet = new Float32Array(this.cols).fill(0);
    }

    draw(active) {
        const { g, w, h } = fitCanvas(this.canvas);
        g.clearRect(0, 0, w, h);
        const s = this.spectra;
        // In-key pitch lines (Keyfield)
        if (this.keyMask) {
            const mask = this.keyMask();
            for (let m = 24; m < 132; m++) {
                if (!(mask & (1 << (m % 12)))) continue;
                const f = 440 * Math.pow(2, (m - 69) / 12);
                if (f < F_LO || f > F_HI) continue;
                const x = xOfF(f, w);
                g.fillStyle = m % 12 === 0 ? 'rgba(212,175,55,0.16)' : GRID;
                g.fillRect(Math.round(x), 0, 1, h);
            }
        }
        const level = (db) => Math.min(1, Math.max(0, (db + 96) / 78));
        for (let c = 0; c < this.cols; c++) {
            const f0 = fOfX((c / this.cols) * w, w), f1 = fOfX(((c + 1) / this.cols) * w, w);
            const live = active && s.live;
            const d = live ? level(s.band(s.pre, f0, f1)) : 0;
            const v = live ? level(s.band(s.post, f0, f1)) : 0;
            this.dry[c] = Math.max(d, this.dry[c] * 0.9);
            this.wet[c] = Math.max(v, this.wet[c] * 0.9);
        }
        const bw = w / this.cols;
        for (let c = 0; c < this.cols; c++) {
            const x = c * bw;
            const dh = this.dry[c] * (h - 28), wh = this.wet[c] * (h - 28);
            g.fillStyle = 'rgba(205,208,218,0.28)';
            g.fillRect(x + 1, h - dh, bw - 2, dh);
            g.fillStyle = this.accent;
            g.globalAlpha = 0.85;
            g.fillRect(x + 1, h - wh, bw - 2, Math.min(wh, 2.5));
            g.globalAlpha = 0.22;
            g.fillRect(x + 1, h - wh, bw - 2, wh);
            g.globalAlpha = 1;
        }
        g.font = '11px Cousine, monospace';
        g.fillStyle = PLATINUM;
        g.fillText(this.labels[0], 12, 18);
        g.fillStyle = this.accent;
        g.fillText(this.labels[1], 12 + g.measureText(this.labels[0] + '  ').width, 18);
        g.fillStyle = DIM;
        for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) g.fillText(t, xOfF(f, w) + 3, h - 6);
    }
}

// ---- Garble: a prism of colour bands, one per wavelet level, lit by the output's energy ----

const PRISM = ['#e0483a', '#e57e2c', '#e0b02a', '#b8c92c', '#58c43a', '#2fa36f', '#2d8f8f', '#2f6fa8', '#3a4f9a', '#3b3a7a'];

export class PrismViz {
    constructor(canvas, spectra, fx) {
        Object.assign(this, { canvas, spectra, fx });
        this.energy = new Float32Array(10);
        this.t = 0;
    }

    draw(active) {
        const { g, w, h } = fitCanvas(this.canvas);
        const fx = this.fx, s = this.spectra;
        const levels = Math.round(fx.get(0)), lo = fx.get(4), hi = fx.get(5);
        const quant = fx.get(1), ratio = fx.get(2);
        this.t += 1 / 60;
        g.fillStyle = '#0b0b0d';
        g.fillRect(0, 0, w, h);
        const rows = 10, rh = h / rows;
        for (let i = 0; i < rows; i++) {
            // Band i covers an octave, highest first (the finest wavelet detail)
            const f1 = 16000 / Math.pow(2, i), f0 = f1 / 2;
            const e = active && s.live ? Math.min(1, Math.max(0, (s.band(s.post, f0, f1) + 90) / 60)) : 0;
            this.energy[i] += (e - this.energy[i]) * 0.2;
            const used = i < levels;
            const inRange = i >= lo && i <= hi;
            const base = used ? (inRange ? 0.5 : 0.2) : 0.1;
            const a = Math.min(1, base + this.energy[i] * 0.75);
            const grad = g.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, PRISM[i]);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            g.globalAlpha = a;
            g.fillStyle = grad;
            // Quantise/ratio break the bands into blocks, like coefficients being dropped
            const blocks = Math.round(1 + quant * 24 + (ratio - 1) * 0.8);
            if (blocks <= 1) {
                g.fillRect(0, i * rh, w, rh - 1);
            } else {
                const bw = w / blocks;
                for (let b = 0; b < blocks; b++) {
                    const keep = Math.sin(b * 12.9898 + i * 78.233 + Math.floor(this.t * 4) * 0.37) * 43758.5453 % 1;
                    if (Math.abs(keep) > quant * 0.85) g.fillRect(b * bw, i * rh, bw - 1, rh - 1);
                }
            }
        }
        g.globalAlpha = 1;
        const fade = g.createLinearGradient(0, h - 18, 0, h);
        fade.addColorStop(0, 'rgba(17,17,17,0)');
        fade.addColorStop(1, '#111');
        g.fillStyle = fade;
        g.fillRect(0, h - 18, w, 18);
    }
}

// ---- Constellate: the QAM grid, with bins clustering onto it or scattering ----

export class ConstellationViz {
    constructor(canvas, spectra, fx, accent) {
        Object.assign(this, { canvas, spectra, fx, accent });
        this.points = Array.from({ length: 900 }, () => [Math.random(), Math.random(), Math.random(), Math.random()]);
        this.t = 0;
    }

    draw(active) {
        const { g, w, h } = fitCanvas(this.canvas);
        const order = Math.round(this.fx.get(0)), cluster = this.fx.get(1);
        const cols = 1 << Math.ceil(order / 2), rows = 1 << Math.floor(order / 2);
        const size = Math.min(w, h) - 24, x0 = (w - size) / 2, y0 = (h - size) / 2;
        const sx = size / cols, sy = size / rows;
        this.t += 1 / 60;
        g.fillStyle = '#0b0b0d';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = GRID;
        g.beginPath();
        g.moveTo(x0 + size / 2, y0); g.lineTo(x0 + size / 2, y0 + size);
        g.moveTo(x0, y0 + size / 2); g.lineTo(x0 + size, y0 + size / 2);
        g.stroke();
        const lvl = active && this.spectra.live ? this.spectra.level : 0;
        // Scattered bins: jitter grows as Cluster falls; brightness follows the signal
        const spread = (1 - cluster) * 0.5;
        g.fillStyle = this.accent;
        for (const p of this.points) {
            const c = Math.floor(p[0] * cols), r = Math.floor(p[1] * rows);
            const jx = (Math.sin(this.t * (0.6 + p[2]) + p[3] * 40) * spread + (p[2] - 0.5) * spread) * sx;
            const jy = (Math.cos(this.t * (0.5 + p[3]) + p[2] * 40) * spread + (p[3] - 0.5) * spread) * sy;
            const x = x0 + (c + 0.5) * sx + jx, y = y0 + (r + 0.5) * sy + jy;
            g.globalAlpha = (0.08 + lvl * 0.5) * (0.4 + 0.6 * cluster * p[2]);
            g.fillRect(x - 1, y - 1, 2, 2);
        }
        // Grid points
        g.globalAlpha = 0.5 + lvl * 0.5;
        const dot = Math.max(2, Math.min(5, 26 / Math.sqrt(cols * rows)));
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                g.beginPath();
                g.arc(x0 + (c + 0.5) * sx, y0 + (r + 0.5) * sy, dot * (0.7 + lvl * 0.5), 0, Math.PI * 2);
                g.fill();
            }
        }
        g.globalAlpha = 1;
        g.font = '13px Cousine, monospace';
        g.fillStyle = 'rgba(180,180,188,0.85)';
        const label = this.fx.format(0);
        g.fillText(label, x0 + size - g.measureText(label).width - 6, y0 + 18);
    }
}

// ---- Conform: the plugin's own measurement against its target band (Fine view) ----
//
// The live curve comes from ConformEffect on the audio thread (wew_meter); the band from the
// plugin's target code in the main-thread module, for pink noise or a loaded .conform file.
// Click a region name to solo it (the plugin's crossovers, on the audio thread).

const REGIONS = [[20, 250, 'Low'], [250, 2000, 'Low-Mid'], [2000, 10000, 'High-Mid'], [10000, 20000, 'High']];
const DB_TOP = 36, DB_BOT = -50; // the editor's window around the 50 Hz–10 kHz normalisation

export class ConformViz {
    constructor(canvas, fx) {
        Object.assign(this, { canvas, fx });
        const ex = fx.exports;
        this.n = ex.conform_cols();
        this.hz = Float32Array.from({ length: this.n }, (_, c) => ex.conform_col_hz(c));
        this.curvePtr = ex.wew_malloc(4 * (1 + 6 * this.n));
        this.solo = 0;
        this.reference = null; // {name, tracks}
        this.labels = []; // hit boxes, set while drawing
        canvas.addEventListener('click', (e) => {
            const r = canvas.getBoundingClientRect();
            const hit = this.labels.find((l) => e.clientX - r.left >= l.x0 && e.clientX - r.left <= l.x1 && e.clientY - r.top <= l.y1);
            if (!hit) return;
            this.solo ^= 1 << hit.region;
            fx.call('conform_set_solo', this.solo);
        });
        canvas.style.cursor = 'pointer';
    }

    // Loads a .conform target with the plugin's decoder; returns {name, tracks}.
    async loadTarget(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        const ex = this.fx.exports;
        const tracks = this.fx.withBytes(await res.arrayBuffer(), (p, len) => ex.conform_load_target(p, len));
        if (tracks < 0) throw new Error(`${url} is not a Conform target`);
        this.reference = { name: this.fx.string(ex.conform_target_name()), tracks };
        return this.reference;
    }

    reset() { this.fx.call('conform_reset_average'); }

    note() {
        if (Math.round(this.fx.get(0)) === 1 && this.reference)
            return `Target: ${this.reference.name} (${this.reference.tracks} track${this.reference.tracks === 1 ? '' : 's'})`;
        return 'Target: pink noise (−3 dB/oct)';
    }

    #band() {
        const ex = this.fx.exports, n = this.n;
        const count = ex.conform_target_curve(Math.round(this.fx.get(0)), this.fx.get(3), this.curvePtr);
        if (!count) return null;
        const f = this.fx.floats(this.curvePtr, 3 * n);
        return { lo: f.subarray(0, n), mid: f.subarray(n, 2 * n), hi: f.subarray(2 * n) };
    }

    draw() {
        const { g, w, h } = fitCanvas(this.canvas);
        const n = this.n, hz = this.hz;
        g.fillStyle = '#0b0b0d';
        g.fillRect(0, 0, w, h);
        const top = 40, bottom = h - 26;
        const xOf = (f) => (Math.log(f / 20) / Math.log(1000)) * w;
        const x = (c) => (c === 0 ? 0 : c === n - 1 ? w : xOf(hz[c]));
        const y = (db) => top + ((DB_TOP - db) / (DB_TOP - DB_BOT)) * (bottom - top);

        const band = this.#band();
        const m = this.fx.meter;
        const live = m && m[0] > 0 ? m.subarray(2, 2 + n) : null;
        const signal = m && m[1] > 0;

        // Band: brightest along its centre, as in the editor
        if (band) {
            const strip = (a, b, alpha) => {
                g.beginPath();
                for (let c = 0; c < n; c++) g.lineTo(x(c), y(a[c]));
                for (let c = n - 1; c >= 0; c--) g.lineTo(x(c), y(b[c]));
                g.closePath();
                g.fillStyle = `rgba(212,175,55,${alpha})`;
                g.fill();
            };
            const inner = (a, b) => a.map((v, c) => (v + b[c]) / 2);
            strip(band.hi, band.lo, 0.12);
            strip(inner(band.hi, band.mid), inner(band.lo, band.mid), 0.22);
            g.lineWidth = 1;
            g.strokeStyle = 'rgba(212,175,55,0.55)';
            for (const curve of [band.lo, band.hi]) {
                g.beginPath();
                for (let c = 0; c < n; c++) g.lineTo(x(c), y(curve[c]));
                g.stroke();
            }
        }

        // Regions: dividers, labels (bright when the mix sits outside the band), solo
        g.font = '12px Cousine, monospace';
        this.labels = [];
        REGIONS.forEach(([lo, hi, name], r) => {
            if (r) { g.fillStyle = GRID; g.fillRect(Math.round(xOf(lo)), top - 6, 1, bottom - top + 6); }
            let out = false;
            if (band && live) {
                let l = 0, b0 = 0, b1 = 0, k = 0;
                for (let c = 0; c < n; c++) if (hz[c] >= lo && hz[c] < hi) { l += live[c]; b0 += band.lo[c]; b1 += band.hi[c]; k++; }
                out = k > 0 && (l < b0 || l > b1);
            }
            const solo = !!(this.solo & (1 << r));
            const label = name;
            const tw = g.measureText(label).width, cx = (xOf(lo) + xOf(hi)) / 2;
            const x0 = cx - tw / 2 + 9;
            // Solo button: an "S" in a circle, filled when soloed
            g.beginPath();
            g.arc(x0 - 11, 20, 7, 0, Math.PI * 2);
            g.strokeStyle = solo ? '#cdd0da' : 'rgba(180,180,188,0.45)';
            g.fillStyle = solo ? '#cdd0da' : 'transparent';
            if (solo) g.fill();
            g.stroke();
            g.font = '10px Cousine, monospace';
            g.fillStyle = solo ? '#111' : 'rgba(180,180,188,0.7)';
            g.fillText('S', x0 - 14, 23.5);
            g.font = '12px Cousine, monospace';
            g.fillStyle = out ? '#f0c448' : solo ? '#cdd0da' : 'rgba(180,180,188,0.7)';
            g.fillText(label, x0, 24);
            this.labels.push({ region: r, x0: x0 - 20, x1: x0 + tw + 4, y1: 34 });
        });

        // Live curve
        if (live) {
            g.beginPath();
            for (let c = 0; c < n; c++) g.lineTo(x(c), y(Math.max(DB_BOT, Math.min(DB_TOP, live[c]))));
            g.strokeStyle = signal ? PLATINUM : 'rgba(205,208,218,0.4)';
            g.lineWidth = 2;
            g.stroke();
        } else {
            g.fillStyle = DIM;
            const t = this.fx.meter ? 'Listening…' : 'Press play to measure';
            g.fillText(t, w / 2 - g.measureText(t).width / 2, (top + bottom) / 2);
        }
        g.fillStyle = DIM;
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
            const t = f >= 1000 ? `${f / 1000}k` : `${f}`;
            g.fillText(t, xOf(f) - g.measureText(t).width / 2, h - 8);
        }
    }
}

// ---- Hero: slow prism waves that swell with whatever is playing ----

export class HeroViz {
    constructor(canvas, spectra) {
        Object.assign(this, { canvas, spectra });
        this.t = 0;
        this.energy = new Float32Array(PRISM.length);
        this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    draw() {
        const { g, w, h } = fitCanvas(this.canvas);
        const s = this.spectra;
        if (!this.still) this.t += 1 / 60;
        g.clearRect(0, 0, w, h);
        const n = PRISM.length;
        for (let i = 0; i < n; i++) {
            const f1 = 16000 / Math.pow(2, i), f0 = f1 / 2;
            const e = s.live ? Math.min(1, Math.max(0, (s.band(s.post, f0, f1) + 90) / 60)) : 0;
            this.energy[i] += (e - this.energy[i]) * 0.12;
            const y = h * (0.18 + 0.64 * (i / (n - 1)));
            const amp = h * (0.025 + this.energy[i] * 0.09);
            g.beginPath();
            for (let x = 0; x <= w; x += 8) {
                const yy = y + Math.sin(x * 0.004 + this.t * (0.4 + i * 0.07) + i) * amp
                    + Math.sin(x * 0.011 - this.t * 0.9 + i * 2) * amp * 0.35;
                x ? g.lineTo(x, yy) : g.moveTo(x, yy);
            }
            g.strokeStyle = PRISM[i];
            g.globalAlpha = 0.16 + this.energy[i] * 0.6;
            g.lineWidth = 10 + this.energy[i] * 18;
            g.stroke();
        }
        g.globalAlpha = 1;
    }
}
