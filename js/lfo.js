// The LFO tab of an editor (a plugin with LFOs), like the plugins' own: pick one of the four
// LFOs, draw its shape, set its rate, sync and depth, trim its routes, and drag its pill onto
// a knob on the main tab to route it there. Shapes and routes are edited through fx.lfo
// (libs/wew_web/js/wew-effect.js), which runs the plugins' C++.

import { h, wordmark } from './dom.js';
import { Knob } from './controls.js';
import { ShapeEditor } from './shape-editor.js';
import { LfoParam, LFO_PRESETS } from './wew-effect.js';

const NEW_ROUTE_AMOUNT = 0.25; // a new route swings its knob by +-25 % (as in the plugins)

export class LfoPanel {
    // rack: the editor (showTab, update, el); fx: its WewEffect.
    constructor(rack, fx, plugin) {
        this.rack = rack;
        this.fx = fx;
        this.lfo = fx.lfo;
        this.sel = 0;
        this.controls = [];

        this.el = h('div', { class: 'rack-pane rack-lfo off', inert: true });
        this.el.append(h('header', { class: 'rack-head' },
            h('div', {}, wordmark(plugin.name, 1, 'wordmark rack-wordmark'), h('div', { class: 'rack-sub' }, 'MODULATION'))));

        // LFO pills (click selects, drag routes) and the On switch
        this.pills = Array.from({ length: this.lfo.count }, (_, l) => {
            const p = h('button', { class: 'lfo-pill', 'aria-label': `LFO ${l + 1}`, title: 'Click to edit · drag onto a knob to modulate it' },
                h('span', { class: 'lfo-dot' }), `LFO ${l + 1}`);
            p.addEventListener('pointerdown', (e) => this.#pillDown(e, l));
            return p;
        });
        this.onSwitch = h('button', { class: 'toggle-pill', role: 'switch', 'aria-label': 'LFO on',
            onclick: () => { this.fx.set(this.#param(LfoParam.on), this.lfo.on(this.sel) ? 0 : 1); this.rack.update(); } },
        h('span', { class: 'toggle-thumb' }));
        this.el.append(h('div', { class: 'lfo-bar' }, h('div', { class: 'lfo-pills' }, this.pills),
            h('label', { class: 'lfo-onoff' }, 'ON', this.onSwitch)));

        this.editor = new ShapeEditor(() => this.update());
        this.el.append(this.editor.el);

        this.presets = LFO_PRESETS.map((name, i) => h('button', { class: 'pill-btn', onclick: () => { this.lfo.preset(this.sel, i); this.update(); } }, name));
        this.el.append(h('div', { class: 'lfo-presets' }, this.presets));

        this.knobs = h('div', { class: 'lfo-knobs' });
        this.routes = h('div', { class: 'lfo-routes' });
        this.el.append(h('div', { class: 'lfo-bottom' }, this.knobs, this.routes));
        this.select(0);
    }

    #param(which, lfo = this.sel) { return this.lfo.param(lfo, which); }

    select(lfo) {
        this.sel = lfo;
        this.editor.setShape(this.lfo.shape(lfo));
        this.knobs.replaceChildren();
        const onchange = () => this.rack.update();
        this.controls = [
            new Knob(this.knobs, this.fx, this.#param(LfoParam.rate), { label: 'Rate' }, onchange),
            new Knob(this.knobs, this.fx, this.#param(LfoParam.sync), { label: 'Sync' }, onchange),
            new Knob(this.knobs, this.fx, this.#param(LfoParam.depth), { label: 'Depth' }, onchange),
        ];
        this.update();
    }

    // After any change: controls, pills, presets, routes and the shape.
    update() {
        this.controls.forEach((c) => c.update());
        const synced = Math.round(this.fx.get(this.#param(LfoParam.sync))) !== 0;
        this.controls[0].root.classList.toggle('dim', synced); // the sync division sets the rate
        this.pills.forEach((p, l) => {
            p.classList.toggle('sel', l === this.sel);
            p.firstChild.classList.toggle('on', this.lfo.on(l));
        });
        const on = this.lfo.on(this.sel);
        this.onSwitch.classList.toggle('on', on);
        this.onSwitch.setAttribute('aria-checked', on);
        if (this.el.classList.contains('off')) return; // the rest is drawn when the tab opens
        this.presets.forEach((b, i) => b.classList.toggle('on', this.lfo.isPreset(this.sel, i)));
        this.#renderRoutes();
        this.editor.render();
    }

    // Every frame: the playhead and the pills' activity dots.
    draw() {
        if (this.el.classList.contains('off')) return;
        this.editor.playhead(this.lfo.phase(this.sel), !this.lfo.on(this.sel));
        this.pills.forEach((p, l) => { p.firstChild.style.opacity = this.lfo.on(l) ? 0.3 + 0.7 * this.lfo.value(l) : ''; });
    }

    // ---- Routes ----

    #renderRoutes() {
        const routes = this.lfo.routes().filter((r) => r.lfo === this.sel);
        if (!routes.length) {
            this.routes.replaceChildren(h('p', { class: 'lfo-empty' }, `Drag LFO ${this.sel + 1} onto a knob on the main tab.`));
            return;
        }
        this.routes.replaceChildren(...routes.map((r) => {
            const amount = h('span', { class: 'lfo-route-amount', title: 'Drag up/down (Shift for fine)' }, `${r.amount >= 0 ? '+' : ''}${Math.round(r.amount * 100)}%`);
            this.#bindAmount(amount, r);
            return h('div', { class: 'lfo-route' },
                h('span', { class: 'lfo-route-name' }, this.fx.param(r.param).name),
                amount,
                h('button', { title: r.bipolar ? 'Bipolar: swings both ways' : 'Unipolar: moves one way',
                    onclick: () => { this.lfo.connect(r.lfo, r.param, r.amount, !r.bipolar); this.rack.update(); } }, r.bipolar ? '±' : '+'),
                h('button', { class: 'rm', title: 'Remove', 'aria-label': `Remove ${this.fx.param(r.param).name}`,
                    onclick: () => { this.lfo.disconnect(r.index); this.rack.update(); } }, '×'));
        }));
    }

    #bindAmount(el, r) {
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            let y0 = e.clientY, a0 = r.amount, fine = e.shiftKey;
            el.setPointerCapture(e.pointerId);
            const move = (m) => {
                if (m.shiftKey !== fine) { fine = m.shiftKey; y0 = m.clientY; a0 = r.amount; }
                r.amount = Math.min(1, Math.max(-1, a0 + (y0 - m.clientY) * 2 / (fine ? 750 : 150)));
                this.lfo.connect(r.lfo, r.param, r.amount, r.bipolar);
                el.textContent = `${r.amount >= 0 ? '+' : ''}${Math.round(r.amount * 100)}%`;
                this.rack.update();
            };
            const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
            e.preventDefault();
        });
    }

    // ---- Routing: drag a pill onto a knob ----

    #pillDown(e, lfo) {
        if (e.button !== 0) return;
        e.preventDefault();
        const x0 = e.clientX, y0 = e.clientY;
        let chip = null, target = null;
        const knobAt = (x, y) => {
            const k = document.elementFromPoint(x, y)?.closest('.knob[data-param]');
            return k && this.rack.el.contains(k) && this.lfo.modulatable(+k.dataset.param) ? k : null;
        };
        const move = (m) => {
            if (!chip) {
                if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) <= 4) return;
                this.select(lfo); // dragging an LFO selects it too
                this.rack.showTab('main');
                chip = h('div', { class: 'lfo-chip', style: { '--accent': getComputedStyle(this.rack.el).getPropertyValue('--accent') } });
                document.body.append(chip);
            }
            const k = knobAt(m.clientX, m.clientY);
            if (k !== target) {
                target?.classList.remove('drop-target');
                k?.classList.add('drop-target');
                target = k;
            }
            chip.textContent = target ? `LFO ${lfo + 1} > ${this.fx.param(+target.dataset.param).name}` : `LFO ${lfo + 1}`;
            chip.classList.toggle('hit', !!target);
            chip.style.left = `${m.clientX + 12}px`;
            chip.style.top = `${m.clientY + 10}px`;
        };
        const up = () => {
            removeEventListener('pointermove', move);
            removeEventListener('pointerup', up);
            if (!chip) { this.select(lfo); return; } // a click
            chip.remove();
            if (target) {
                target.classList.remove('drop-target');
                const param = +target.dataset.param;
                if (!this.lfo.routes().some((r) => r.lfo === lfo && r.param === param)) this.lfo.connect(lfo, param, NEW_ROUTE_AMOUNT, true);
                if (!this.lfo.on(lfo)) this.fx.set(this.#param(LfoParam.on, lfo), 1); // routing an LFO switches it on
            }
            this.rack.update();
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
    }
}
