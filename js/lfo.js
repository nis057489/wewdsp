// The LFO tab of an editor (a plugin with LFOs), like the plugins' own: pick one of the four
// LFOs, draw its shape, set its rate, sync and depth, trim its routes, and drag its pill onto
// a knob on the main tab to route it there. Shapes and routes are edited through fx.lfo
// (libs/wew_web/js/wew-effect.js), which runs the plugins' C++.

import { h, wordmark } from './dom.js';
import { Knob } from './controls.js';
import { LfoParam, LFO_PRESETS } from './wew-effect.js';

const SVG = 'http://www.w3.org/2000/svg';
const INSET = 8; // points stay clear of the editor's edge
const NEW_ROUTE_AMOUNT = 0.25; // a new route swings its knob by +-25 % (as in the plugins)

function svg(tag, attrs = {}, parent) {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
}

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

        // Shape editor
        this.svg = svg('svg', { class: 'lfo-svg', 'aria-label': 'LFO shape' });
        this.grid = svg('g', { class: 'lfo-grid' }, this.svg);
        this.fill = svg('path', { class: 'lfo-fill' }, this.svg);
        this.curve = svg('path', { class: 'lfo-curve' }, this.svg);
        this.head = svg('line', { class: 'lfo-head' }, this.svg);
        this.headDot = svg('circle', { class: 'lfo-head-dot', r: 3.5 }, this.svg);
        this.handles = svg('g', {}, this.svg);
        this.points = svg('g', {}, this.svg);
        this.shapeEl = h('div', { class: 'lfo-shape', title: 'Drag points · drag the small handles to bend · double-click to add or remove a point · Shift snaps' });
        this.shapeEl.append(this.svg);
        this.el.append(this.shapeEl);
        this.#bindShape();
        new ResizeObserver(() => this.renderShape()).observe(this.shapeEl);

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
        this.el.classList.toggle('idle', !on);
        if (this.el.classList.contains('off')) return; // the rest is drawn when the tab opens
        this.presets.forEach((b, i) => b.classList.toggle('on', this.lfo.isPreset(this.sel, i)));
        this.#renderRoutes();
        this.renderShape();
    }

    // Every frame: the playhead and the pills' activity dots.
    draw() {
        if (this.el.classList.contains('off')) return;
        const phase = this.lfo.phase(this.sel);
        const x = this.#px(phase), y = this.#py(this.lfo.shapeAt(this.sel, phase));
        this.head.setAttribute('x1', x);
        this.head.setAttribute('x2', x);
        this.headDot.setAttribute('cx', x);
        this.headDot.setAttribute('cy', y);
        this.pills.forEach((p, l) => { p.firstChild.style.opacity = this.lfo.on(l) ? 0.3 + 0.7 * this.lfo.value(l) : ''; });
    }

    // ---- Shape ----

    #px(x) { return INSET + x * (this.w - 2 * INSET); }
    #py(y) { return this.h - INSET - y * (this.h - 2 * INSET); }
    #sx(px) { return Math.min(1, Math.max(0, (px - INSET) / (this.w - 2 * INSET))); }
    #sy(py) { return Math.min(1, Math.max(0, (this.h - INSET - py) / (this.h - 2 * INSET))); }

    renderShape() {
        const r = this.shapeEl.getBoundingClientRect();
        if (!r.width) return;
        this.w = r.width;
        this.h = r.height;
        this.svg.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);

        this.grid.replaceChildren();
        for (const x of [0.25, 0.5, 0.75]) svg('line', { x1: this.#px(x), x2: this.#px(x), y1: 0, y2: this.h }, this.grid);
        svg('line', { x1: 0, x2: this.w, y1: this.#py(0.5), y2: this.#py(0.5) }, this.grid);

        const steps = Math.round(this.w);
        let d = '';
        for (let i = 0; i <= steps; i++) {
            const x = i / steps;
            d += `${i ? 'L' : 'M'}${this.#px(x).toFixed(1)},${this.#py(this.lfo.shapeAt(this.sel, x)).toFixed(1)}`;
        }
        this.curve.setAttribute('d', d);
        this.fill.setAttribute('d', `${d}L${this.#px(1)},${this.#py(0)}L${this.#px(0)},${this.#py(0)}Z`);
        this.head.setAttribute('y1', 2);
        this.head.setAttribute('y2', this.h - 2);

        this.pts = this.lfo.points(this.sel);
        this.handles.replaceChildren();
        this.points.replaceChildren();
        this.pts.forEach((p, i) => {
            const q = this.pts[i + 1];
            if (q && q.x > p.x) {
                const mx = (p.x + q.x) / 2;
                svg('circle', { class: 'lfo-handle', r: 3, cx: this.#px(mx), cy: this.#py(this.lfo.shapeAt(this.sel, mx)) }, this.handles);
            }
            svg('circle', { class: 'lfo-point', r: 4.5, cx: this.#px(p.x), cy: this.#py(p.y) }, this.points);
        });
    }

    // What's under (x, y) in the editor: {point} or {handle}, or null.
    #hit(x, y) {
        let best = null, bestD = 9 * 9;
        this.pts.forEach((p, i) => {
            const d = (this.#px(p.x) - x) ** 2 + (this.#py(p.y) - y) ** 2;
            if (d <= bestD) { bestD = d; best = { point: i }; }
        });
        if (best) return best;
        for (let i = 0; i + 1 < this.pts.length; i++) {
            const p = this.pts[i], q = this.pts[i + 1];
            if (q.x <= p.x) continue;
            const mx = (p.x + q.x) / 2;
            if ((this.#px(mx) - x) ** 2 + (this.#py(this.lfo.shapeAt(this.sel, mx)) - y) ** 2 <= 8 * 8) return { handle: i };
        }
        return null;
    }

    #bindShape() {
        const local = (e) => {
            const r = this.svg.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        };
        let drag = null;
        this.svg.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const [x, y] = local(e);
            const hit = this.#hit(x, y);
            if (!hit) return;
            const p = this.pts[hit.point ?? hit.handle];
            drag = { ...hit, y, curve: p.curve, rising: hit.handle !== undefined && this.pts[hit.handle + 1].y >= p.y };
            this.svg.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        this.svg.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const [x, y] = local(e);
            if (drag.point !== undefined) {
                let sx = this.#sx(x), sy = this.#sy(y);
                if (e.shiftKey) { sx = Math.round(sx * 16) / 16; sy = Math.round(sy * 8) / 8; } // snap
                this.lfo.move(this.sel, drag.point, sx, sy);
            } else {
                const up = (drag.y - y) / 60; // dragging up bows the segment upwards
                this.lfo.bend(this.sel, drag.handle, drag.curve + (drag.rising ? -up : up));
            }
            this.update();
        });
        const end = () => { drag = null; };
        this.svg.addEventListener('pointerup', end);
        this.svg.addEventListener('pointercancel', end);
        this.svg.addEventListener('dblclick', (e) => {
            const [x, y] = local(e);
            const hit = this.#hit(x, y);
            if (hit?.point !== undefined) this.lfo.remove(this.sel, hit.point);
            else if (hit?.handle !== undefined) this.lfo.bend(this.sel, hit.handle, 0);
            else this.lfo.insert(this.sel, this.#sx(x), this.#sy(y));
            this.update();
        });
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
