// Shaper's editor on the site, as in the plugin (plugins/shaper/src/shaper_view.cpp): the mode,
// the volume curve over a scope of what the detector hears and what comes out, presets, and
// the Lows / Highs curves when split. Its knobs come from content.js like any rack's. In the
// browser there is no sidechain, so the detector listens to Shaper's own input.

import { h } from './dom.js';
import { ShapeEditor, svg } from './shape-editor.js';

const MODES = ['Sync', 'Trigger', 'Follow'];
const FOLLOW = 2;
const PRESETS = ['Pump', 'Duck', 'Gate', 'Swell', 'Flat'];
const BANDS = ['LOWS', 'HIGHS'];
const BINS = 256; // shaper::kScopeBins

// The scope's vertical scale: -48..0 dB.
const levelDb = (db) => Math.min(1, Math.max(0, (db + 48) / 48));
const level = (a) => levelDb(20 * Math.log10(Math.max(a, 1e-6)));

function segments(labels, onpick) {
    const buttons = labels.map((l, i) => h('button', { class: 'seg', onclick: () => onpick(i) }, l));
    return { el: h('div', { class: 'seg-group' }, buttons), buttons };
}

export class ShaperPanel {
    // rack: the editor (el, update); fx: its WewEffect.
    constructor(rack, fx) {
        this.rack = rack;
        this.fx = fx;
        this.band = 0;
        this.ids = { mode: fx.paramId('Mode'), split: fx.paramId('Split'), threshold: fx.paramId('Threshold') };
        const ex = fx.exports;
        const sync = () => { ex.shaper_curves_apply(fx.inst); fx.load('shaper_curves_load', fx.save('shaper_curves_save')); };
        this.curves = [0, 1].map((b) => fx.shape(ex.shaper_curve(fx.inst, b), sync));
        this.sync = sync;

        this.modes = segments(MODES, (i) => { fx.set(this.ids.mode, i); rack.update(); });
        this.bands = segments(BANDS, (i) => { this.band = i; this.update(); });
        this.editor = new ShapeEditor(() => this.update());
        this.editor.el.classList.add('shaper-scope');
        this.scope = {
            detector: svg('path', { class: 'scope-det' }, this.editor.under),
            output: svg('path', { class: 'scope-out' }, this.editor.under),
            gain: svg('path', { class: 'scope-gain' }, this.editor.under),
            threshold: svg('line', { class: 'scope-thr' }, this.editor.under),
            label: svg('text', { class: 'scope-thr-label', 'text-anchor': 'end' }, this.editor.under),
        };
        this.scope.label.textContent = 'THRESHOLD';
        this.presets = PRESETS.map((name, i) => h('button', { class: 'pill-btn', onclick: () => {
            ex.shaper_curve_preset(fx.inst, this.editBand(), i);
            sync();
            this.update();
        } }, name));
        this.hint = h('span', { class: 'shaper-hint' });
        this.presetRow = h('div', { class: 'shaper-presets' }, this.presets);
        this.tools = h('div', { class: 'shaper-tools' }, this.presetRow, this.hint, this.bands.el);

        this.el = h('div', { class: 'shaper' }, h('div', { class: 'shaper-bar' }, this.modes.el), this.editor.el, this.tools);
    }

    mode() { return Math.round(this.fx.get(this.ids.mode)); }
    split() { return this.fx.get(this.ids.split) >= 0.5; }
    editBand() { return this.split() ? this.band : 0; }

    // After any change: mode, tools, the curve being edited, and which controls apply.
    update() {
        const mode = this.mode(), follow = mode === FOLLOW, split = this.split();
        this.modes.buttons.forEach((b, i) => { b.classList.toggle('sel', i === mode); b.setAttribute('aria-pressed', i === mode); });
        this.bands.buttons.forEach((b, i) => b.classList.toggle('sel', i === this.band));
        this.bands.el.hidden = follow || !split;
        this.presetRow.hidden = follow;
        this.presets.forEach((b, i) => b.classList.toggle('on', !!this.fx.exports.shaper_curve_is_preset(this.fx.inst, this.editBand(), i)));
        this.hint.textContent = follow ? `Follow: ${split ? 'the lows duck' : 'the volume ducks'} as the detector rises over Threshold` : '';
        this.editor.setShape(follow ? null : this.curves[this.editBand()], !follow && split ? this.curves[1 - this.band] : null);

        const dim = { Rate: follow, Threshold: mode === 0, Attack: mode === 0, Release: mode === 0, Crossover: !split };
        this.rack.el.querySelectorAll('[data-param]').forEach((c) => c.classList.toggle('dim', !!dim[this.fx.param(+c.dataset.param).name]));
    }

    // Every frame: the scope and playhead, from the audio thread's latest wew_meter.
    draw() {
        const m = this.fx.meter;
        const ed = this.editor;
        if (!m || m.length < 3 + 3 * BINS || !ed.w) return;
        const mode = m[0], x = (b) => ed.px((b + 0.5) / BINS).toFixed(1), base = ed.py(0).toFixed(1);
        const area = (offset) => {
            let d = `M${x(0)},${base}`;
            for (let b = 0; b < BINS; b++) d += `L${x(b)},${ed.py(level(m[offset + b])).toFixed(1)}`;
            return `${d}L${x(BINS - 1)},${base}Z`;
        };
        this.scope.detector.setAttribute('d', area(3));
        this.scope.output.setAttribute('d', area(3 + BINS));
        let gain = '';
        if (mode === FOLLOW)
            for (let b = 0; b < BINS; b++) gain += `${b ? 'L' : 'M'}${x(b)},${ed.py(m[3 + 2 * BINS + b]).toFixed(1)}`;
        this.scope.gain.setAttribute('d', gain);

        const showThreshold = this.mode() !== 0;
        const ty = ed.py(levelDb(this.fx.get(this.ids.threshold)));
        Object.assign(this.scope.threshold.style, { display: showThreshold ? '' : 'none' });
        this.scope.label.style.display = showThreshold ? '' : 'none';
        this.scope.threshold.setAttribute('x1', 4);
        this.scope.threshold.setAttribute('x2', ed.w - 4);
        this.scope.threshold.setAttribute('y1', ty);
        this.scope.threshold.setAttribute('y2', ty);
        this.scope.label.setAttribute('x', ed.w - 8);
        this.scope.label.setAttribute('y', ty - 5);

        if (mode !== FOLLOW) ed.playhead(m[1]);
    }
}
