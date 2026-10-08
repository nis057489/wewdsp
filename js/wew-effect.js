// Main-thread side of a plugin running in the browser.
//
//   const fx = await WewEffect.create(audioContext, 'wasm/garble.wasm');
//   source.connect(fx.node); fx.node.connect(audioContext.destination);
//   fx.info.params          // [{name, module, min, max, def, flags}], id = index
//   fx.set(id, value)       // sanitised (clamped, stepped) like the plugin does; returns it
//   fx.get(id), fx.format(id, value), fx.latency, fx.onlatency = (samples) => {}
//   fx.meter, fx.onmeter    // latest wew_meter data from the audio thread, if the plugin has it
//   fx.call(name, ...args)  // a plugin export on the audio thread's instance
//   fx.exports              // the main-thread module, with withBytes / floats / string helpers
//   fx.lfo                  // the LFOs (null if the effect has none): see WewLfos
//
// The DSP runs in an AudioWorklet (wew-worklet.js). A second instance of the module on the
// main thread answers info, sanitising and display text synchronously, and holds the LFOs'
// shapes and routes, which are copied to the audio thread after every change.

const IMPORTS = { env: { emscripten_notify_memory_growth() {} } };
const workletReady = new WeakMap(); // AudioContext -> Promise
const moduleCache = new Map(); // url -> Promise<{bytes, module}>

// log: moved on a log scale by knobs and LFOs (wewdsp's own flag, kParamLog)
export const ParamFlags = { stepped: 1 << 0, automatable: 1 << 5, modulatable: 1 << 10, enum: 1 << 16, log: 1 << 30 };

function loadModule(url) {
    if (!moduleCache.has(url)) {
        moduleCache.set(url, (async () => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${url}: ${res.status}`);
            const bytes = await res.arrayBuffer();
            return { bytes, module: await WebAssembly.compile(bytes) };
        })());
    }
    return moduleCache.get(url);
}

export class WewEffect {
    static async create(ctx, url) {
        if (!workletReady.has(ctx)) {
            workletReady.set(ctx, ctx.audioWorklet.addModule(new URL('./wew-worklet.js', import.meta.url)));
        }
        const [{ bytes, module }] = await Promise.all([loadModule(url), workletReady.get(ctx)]);
        const { exports: ex } = await WebAssembly.instantiate(module, IMPORTS);
        if (ex._initialize) ex._initialize();
        return new WewEffect(ctx, ex, bytes);
    }

    constructor(ctx, ex, bytes) {
        this.ex = ex;
        this.inst = ex.wew_create(ctx.sampleRate, 128);
        this.info = JSON.parse(this.#str(ex.wew_info()));
        this.values = this.info.params.map((p) => p.def);
        this.latency = ex.wew_latency(this.inst);
        this.onlatency = null;
        this.meter = null;
        this.onmeter = null;
        this.scratch = ex.wew_malloc(4096); // main-thread buffer for the LFO calls
        this.lfo = this.info.lfos ? new WewLfos(this) : null;
        this.node = new AudioWorkletNode(ctx, 'wew-effect', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            processorOptions: { bytes, params: this.values, lfos: this.info.lfos },
        });
        this.node.port.onmessage = (e) => {
            if (e.data.type === 'meter') {
                this.meter = e.data.data;
                if (this.onmeter) this.onmeter(this.meter);
                return;
            }
            if (e.data.type === 'lfo') {
                this.lfo.state = e.data.data;
                return;
            }
            if (e.data.latency !== undefined && e.data.latency !== this.latency) {
                this.latency = e.data.latency;
                if (this.onlatency) this.onlatency(this.latency);
            }
        };
    }

    #str(ptr) {
        const mem = new Uint8Array(this.ex.memory.buffer);
        let end = ptr;
        while (mem[end]) end++;
        return new TextDecoder().decode(mem.subarray(ptr, end));
    }

    get exports() { return this.ex; }

    // Copies bytes into the main-thread module for fn(ptr, length); returns fn's result.
    withBytes(bytes, fn) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const ptr = this.ex.wew_malloc(u8.length || 1);
        new Uint8Array(this.ex.memory.buffer, ptr, u8.length).set(u8);
        try {
            return fn(ptr, u8.length);
        } finally {
            this.ex.wew_free(ptr);
        }
    }

    // A copy of n floats at ptr in the main-thread module.
    floats(ptr, n) { return new Float32Array(this.ex.memory.buffer, ptr, n).slice(); }
    string(ptr) { return this.#str(ptr); }

    // Calls a plugin export on the audio thread's instance: ex[name](instance, ...args).
    call(name, ...args) { this.node.port.postMessage({ type: 'call', name, args }); }

    param(id) { return this.info.params[id]; }
    paramId(name) { return this.info.params.findIndex((p) => p.name === name); }
    get(id) { return this.values[id]; }

    set(id, value) {
        const v = this.ex.wew_set_param(this.inst, id, value);
        if (v !== this.values[id]) {
            this.values[id] = v;
            this.node.port.postMessage({ type: 'param', id, value: v });
        }
        return v;
    }

    format(id, value = this.values[id]) { return this.#str(this.ex.wew_format(id, value)); }

    // For parameters that only take effect on prepare (Keyfield's FFT size). Latency may change.
    prepare() { this.node.port.postMessage({ type: 'prepare' }); }
    reset() { this.node.port.postMessage({ type: 'reset' }); }

    destroy() {
        this.node.port.postMessage({ type: 'destroy' });
        this.node.disconnect();
        this.ex.wew_destroy(this.inst);
    }
}

// The LFOs of an effect that has them (fx.lfo). Their host parameters (On, Rate, Sync, Depth)
// are ordinary parameters, after the effect's own: fx.set(fx.lfo.param(lfo, LfoParam.on), 1).
// Shapes and routes live in the main-thread module (the same C++ the plugins use) and are
// sent to the audio thread after each change.
export const LfoParam = { on: 0, rate: 1, sync: 2, depth: 3 };
export const LFO_PRESETS = ['Sine', 'Triangle', 'Saw Up', 'Saw Down', 'Square'];

export class WewLfos {
    constructor(fx) {
        this.fx = fx;
        this.count = fx.info.lfos;
        this.first = fx.info.params.length - this.count * 4; // index of LFO 1's first parameter
        this.state = new Float32Array(this.count * 2); // [phase, value] per LFO, from the audio thread
    }

    get #ex() { return this.fx.ex; }
    get #inst() { return this.fx.inst; }

    param(lfo, which) { return this.first + lfo * 4 + which; }
    on(lfo) { return this.fx.get(this.param(lfo, LfoParam.on)) >= 0.5; }
    phase(lfo) { return this.state[2 * lfo]; }
    value(lfo) { return this.state[2 * lfo + 1]; }

    // ---- Shape ----
    shapeAt(lfo, phase) { return this.#ex.wew_lfo_value(this.#inst, lfo, phase); }
    points(lfo) {
        const n = this.#ex.wew_lfo_points(this.#inst, lfo, this.fx.scratch, 64 * 3);
        const f = new Float32Array(this.#ex.memory.buffer, this.fx.scratch, n * 3);
        return Array.from({ length: n }, (_, i) => ({ x: f[3 * i], y: f[3 * i + 1], curve: f[3 * i + 2] }));
    }
    insert(lfo, x, y) { const i = this.#ex.wew_lfo_insert(this.#inst, lfo, x, y); this.#sync(); return i; }
    remove(lfo, point) { this.#ex.wew_lfo_remove(this.#inst, lfo, point); this.#sync(); }
    move(lfo, point, x, y) { this.#ex.wew_lfo_move(this.#inst, lfo, point, x, y); this.#sync(); }
    bend(lfo, point, curve) { this.#ex.wew_lfo_bend(this.#inst, lfo, point, curve); this.#sync(); }
    preset(lfo, preset) { this.#ex.wew_lfo_preset(this.#inst, lfo, preset); this.#sync(); }
    isPreset(lfo, preset) { return !!this.#ex.wew_lfo_is_preset(this.#inst, lfo, preset); }

    // ---- Routes ----
    // [{index, lfo, param, amount, bipolar}]; amount is a fraction of the knob's travel.
    routes() {
        const n = this.#ex.wew_mod_routes(this.#inst, this.fx.scratch, 1024);
        const f = new Float32Array(this.#ex.memory.buffer, this.fx.scratch, n * 4);
        return Array.from({ length: n }, (_, i) => ({ index: i, lfo: f[4 * i], param: f[4 * i + 1], amount: f[4 * i + 2], bipolar: f[4 * i + 3] > 0 }));
    }
    modulatable(param) { return !!this.#ex.wew_mod_modulatable(param); }
    // Adds or updates a route; false if the parameter can't be modulated.
    connect(lfo, param, amount, bipolar) {
        const ok = !!this.#ex.wew_mod_connect(this.#inst, lfo, param, amount, bipolar ? 1 : 0);
        if (ok) this.#sync();
        return ok;
    }
    disconnect(index) { this.#ex.wew_mod_disconnect(this.#inst, index); this.#sync(); }

    // Where the routes take a parameter now: {lo, hi, now} in its units, or null.
    range(param) {
        const ex = this.#ex, lfoPtr = this.fx.scratch, outPtr = this.fx.scratch + 64;
        const vals = new Float32Array(ex.memory.buffer, lfoPtr, this.count);
        for (let l = 0; l < this.count; l++) vals[l] = this.value(l);
        if (!ex.wew_mod_range(this.#inst, param, lfoPtr, outPtr)) return null;
        const [lo, hi, now] = new Float64Array(ex.memory.buffer, outPtr, 3);
        return { lo, hi, now };
    }

    // Copies the shapes and routes to the audio thread.
    #sync() {
        const n = this.#ex.wew_mod_save(this.#inst, this.fx.scratch, 4096);
        this.fx.node.port.postMessage({ type: 'mod', bytes: new Uint8Array(this.#ex.memory.buffer, this.fx.scratch, n).slice() });
    }
}
