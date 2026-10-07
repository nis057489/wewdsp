// AudioWorklet processor that runs one plugin's DSP (<slug>.wasm, the C ABI in
// src/web_effect.cpp) on stereo audio. Created by wew-effect.js, which passes the module's
// bytes in processorOptions and sends parameter changes over the port:
//   {type: 'param', id, value}   set a parameter (already sanitised by the main thread)
//   {type: 'prepare'}            re-prepare, for parameters that apply on prepare (FFT size)
//   {type: 'reset'}              clear the effect's internal state
//   {type: 'destroy'}            free the instance; the processor then stops
// and reports {type: 'ready' | 'latency', latency} (samples) back.

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
        return true;
    }
}

registerProcessor('wew-effect', WewEffectProcessor);
