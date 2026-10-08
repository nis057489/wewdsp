// AudioWorklet processor that runs one plugin's DSP (<slug>.wasm, the C ABI in
// src/web_effect.cpp) on stereo audio. Created by wew-effect.js, which passes the module's
// bytes in processorOptions and sends parameter changes over the port:
//   {type: 'param', id, value}   set a parameter (already sanitised by the main thread)
//   {type: 'prepare'}            re-prepare, for parameters that apply on prepare (FFT size)
//   {type: 'reset'}              clear the effect's internal state
//   {type: 'call', name, args}   call a plugin export with (instance, ...args)
//   {type: 'mod', bytes}         replace the LFOs' shapes and routes (wew_mod_save's bytes)
//   {type: 'destroy'}            free the instance; the processor then stops
// and reports {type: 'ready' | 'latency', latency} (samples) back. Modules that export
// wew_meter also get {type: 'meter', data: Float32Array} about 30 times a second, and
// effects with LFOs {type: 'lfo', data: Float32Array} (each LFO's phase and value).

const IMPORTS = { env: { emscripten_notify_memory_growth() {} } };

class WewEffectProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.ex = null;
        this.inst = 0;
        this.alive = true;
        this.queue = [];
        this.port.onmessage = (e) => (this.ex ? this.handle(e.data) : this.queue.push(e.data));

        const { bytes, params } = options.processorOptions;
        WebAssembly.instantiate(bytes, IMPORTS).then(({ instance }) => {
            const ex = instance.exports;
            if (ex._initialize) ex._initialize();
            this.inst = ex.wew_create(sampleRate, 128);
            // Start from the main thread's current values, then any changes queued since
            (params || []).forEach((v, id) => ex.wew_set_param(this.inst, id, v));
            ex.wew_prepare(this.inst);
            this.meterEvery = Math.max(1, Math.round(sampleRate / 128 / 30));
            this.meterCount = 0;
            if (ex.wew_meter) {
                this.meterMax = 4096;
                this.meterPtr = ex.wew_malloc(this.meterMax * 4);
            }
            this.lfoCount = options.processorOptions.lfos || 0;
            if (this.lfoCount) this.lfoPtr = ex.wew_malloc(this.lfoCount * 8);
            this.ex = ex;
            this.queue.forEach((m) => this.handle(m));
            this.queue = [];
            this.port.postMessage({ type: 'ready', latency: ex.wew_latency(this.inst) });
        });
    }

    handle(m) {
        const ex = this.ex;
        switch (m.type) {
            case 'param':
                ex.wew_set_param(this.inst, m.id, m.value);
                break;
            case 'prepare':
                ex.wew_prepare(this.inst);
                this.port.postMessage({ type: 'latency', latency: ex.wew_latency(this.inst) });
                break;
            case 'reset':
                ex.wew_reset(this.inst);
                break;
            case 'call':
                if (typeof ex[m.name] === 'function') ex[m.name](this.inst, ...(m.args || []));
                break;
            case 'mod': {
                const ptr = ex.wew_malloc(m.bytes.length || 1);
                new Uint8Array(ex.memory.buffer, ptr, m.bytes.length).set(m.bytes);
                ex.wew_mod_load(this.inst, ptr, m.bytes.length);
                ex.wew_free(ptr);
                break;
            }
            case 'destroy':
                ex.wew_destroy(this.inst);
                this.inst = 0;
                this.alive = false;
                break;
        }
    }

    process(inputs, outputs) {
        if (!this.alive) return false;
        const out = outputs[0];
        const inp = inputs[0];
        const n = out[0].length;
        const ex = this.ex;
        if (!ex) {
            out.forEach((ch) => ch.fill(0));
            return true;
        }
        // Views are recreated each block: memory growth detaches the old buffer.
        for (let c = 0; c < 2; c++) {
            const dst = new Float32Array(ex.memory.buffer, ex.wew_input(this.inst, c), n);
            const src = inp.length ? inp[Math.min(c, inp.length - 1)] : null; // mono feeds both
            if (src) dst.set(src);
            else dst.fill(0);
        }
        ex.wew_process(this.inst, n);
        for (let c = 0; c < out.length; c++) {
            out[c].set(new Float32Array(ex.memory.buffer, ex.wew_output(this.inst, Math.min(c, 1)), n));
        }
        if (++this.meterCount >= this.meterEvery) {
            this.meterCount = 0;
            if (this.meterPtr) {
                const count = ex.wew_meter(this.inst, this.meterPtr, this.meterMax);
                if (count) this.port.postMessage({ type: 'meter', data: new Float32Array(ex.memory.buffer, this.meterPtr, count).slice() });
            }
            if (this.lfoPtr) {
                ex.wew_lfo_state(this.inst, this.lfoPtr);
                this.port.postMessage({ type: 'lfo', data: new Float32Array(ex.memory.buffer, this.lfoPtr, this.lfoCount * 2).slice() });
            }
        }
        return true;
    }
}

registerProcessor('wew-effect', WewEffectProcessor);
