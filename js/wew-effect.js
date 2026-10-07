// Main-thread side of a plugin running in the browser.
//
//   const fx = await WewEffect.create(audioContext, 'wasm/garble.wasm');
//   source.connect(fx.node); fx.node.connect(audioContext.destination);
//   fx.info.params          // [{name, module, min, max, def, flags}], id = index
//   fx.set(id, value)       // sanitised (clamped, stepped) like the plugin does; returns it
//   fx.get(id), fx.format(id, value), fx.latency, fx.onlatency = (samples) => {}
//
// The DSP runs in an AudioWorklet (wew-worklet.js). A second instance of the module on the
// main thread answers info, sanitising and display text synchronously.

const IMPORTS = { env: { emscripten_notify_memory_growth() {} } };
const workletReady = new WeakMap(); // AudioContext -> Promise
const moduleCache = new Map(); // url -> Promise<{bytes, module}>

export const ParamFlags = { stepped: 1 << 0, automatable: 1 << 5, modulatable: 1 << 10, enum: 1 << 16 };

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
        this.node = new AudioWorkletNode(ctx, 'wew-effect', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            processorOptions: { bytes, params: this.values },
        });
        this.node.port.onmessage = (e) => {
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
