// Contour's editor on the site, as in the plugin (plugins/contour/src/contour_view.cpp): the EQ
// display (analyzer, the bands' curves, draggable numbered nodes) over the selected band's
// controls. The curves come from the plugin's own filter designs (contour_curves).

import { h } from './dom.js';
import { Knob, Toggle } from './controls.js';
import { svg } from './shape-editor.js';

const BANDS = 16, BAND_PARAMS = 10;
const P = { used: 0, type: 1, freq: 2, gain: 3, q: 4, slope: 5, stereo: 6, range: 7, threshold: 8, bypass: 9 };
const G = { output: 160, autoGain: 161, attack: 162, release: 163, sidechain: 164, analyzer: 165 };
const TYPES = ['Bell', 'Low Shelf', 'High Shelf', 'Low Cut', 'High Cut', 'Notch', 'Band Pass', 'Tilt Shelf'];
const STEREO = ['Stereo', 'Left', 'Right', 'Mid', 'Side'];
const BELL = 0, LOW_CUT = 3, HIGH_CUT = 4, TILT = 7;
const hasGain = (t) => t === 0 || t === 1 || t === 2 || t === TILT;
const hasSlope = (t) => t === LOW_CUT || t === HIGH_CUT;
const COLS = 256, N = 200; // analyzer columns; curve points
const DB_RANGE = 18, FLOOR = -90;
const KNOBS = [['freq', 'Freq'], ['gain', 'Gain'], ['q', 'Q'], ['slope', 'Slope'], ['range', 'Range'], ['threshold', 'Threshold']];

const id = (b, p) => b * BAND_PARAMS + P[p];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class ContourPanel {
    constructor(rack, fx) {
        this.rack = rack;
        this.fx = fx;
        this.selected = -1;
        const ex = fx.exports;
        this.curvesPtr = ex.wew_malloc((2 + 2 * BANDS) * N * 4);
        this.dynPtr = ex.wew_malloc(BANDS * 4);

        // Display
        this.svg = svg('svg', { class: 'eq-svg' });
        this.grid = svg('g', { class: 'eq-grid' }, this.svg);
        this.pre = svg('path', { class: 'eq-pre' }, this.svg);
        this.post = svg('path', { class: 'eq-post' }, this.svg);
        this.reach = svg('g', { class: 'eq-reach' }, this.svg);
        this.fill = svg('path', { class: 'eq-fill' }, this.svg);
        this.curve = svg('path', { class: 'eq-curve' }, this.svg);
        this.live = svg('path', { class: 'eq-live' }, this.svg);
        this.nodes = svg('g', {}, this.svg);
        this.display = h('div', { class: 'eq-display', title: 'Double-click to add a band · drag a band to move it · scroll over it to change its Q · double-click it to remove it' }, this.svg);
        new ResizeObserver(() => this.#layout()).observe(this.display);
        this.#bindDisplay();

        // Band panel: the selected band, then the dynamics shared by every band
        this.title = h('span', { class: 'eq-title' });
        this.remove = h('button', { class: 'eq-remove', 'aria-label': 'Remove band', onclick: () => this.#set(id(this.selected, 'used'), 0) }, '×');
        this.typeBtn = h('button', { class: 'pill-btn', onclick: () => this.#cycle('type', TYPES.length) });
        this.stereoBtn = h('button', { class: 'pill-btn', onclick: () => this.#cycle('stereo', STEREO.length) });
        this.bypassBtn = h('button', { class: 'pill-btn', onclick: () => this.#set(id(this.selected, 'bypass'), this.fx.get(id(this.selected, 'bypass')) >= 0.5 ? 0 : 1) }, 'Bypass');
        this.bandKnobs = h('div', { class: 'eq-knobs' });
        this.hint = h('p', { class: 'eq-hint' }, 'Double-click the display to add a band. Drag a band to move it; scroll over it to change its Q.');
        this.bandBox = h('div', { class: 'eq-band' },
            h('div', { class: 'eq-band-side' }, h('div', { class: 'eq-band-head' }, this.title, this.remove), this.typeBtn, this.stereoBtn, this.bypassBtn),
            this.bandKnobs);
        const onchange = () => rack.update();
        const dyn = h('div', { class: 'eq-dyn' });
        this.globals = [
            new Knob(dyn, fx, G.attack, { label: 'Attack' }, onchange),
            new Knob(dyn, fx, G.release, { label: 'Release' }, onchange),
            new Toggle(dyn, fx, G.sidechain, { label: 'Sidechain' }, onchange),
        ];
        this.knobs = [];
        this.el = h('div', { class: 'eq' }, this.display, h('div', { class: 'eq-panel' }, this.hint, this.bandBox, dyn));
        this.#select(-1);
    }

    #set(param, v) {
        this.fx.set(param, v);
        this.rack.update();
    }

    #cycle(p, count) { this.#set(id(this.selected, p), (Math.round(this.fx.get(id(this.selected, p))) + 1) % count); }

    band(b) {
        const g = (p) => this.fx.get(id(b, p));
        return { used: g('used') >= 0.5, bypass: g('bypass') >= 0.5, type: Math.round(g('type')), freq: g('freq'), gain: g('gain'), q: g('q'), stereo: Math.round(g('stereo')) };
    }

    #select(b) {
        this.selected = b;
        this.hint.hidden = b >= 0;
        this.bandBox.hidden = b < 0;
        this.bandKnobs.replaceChildren();
        this.knobs = b < 0 ? [] : KNOBS.map(([p, label]) => new Knob(this.bandKnobs, this.fx, id(b, p), { label }, () => this.rack.update()));
        this.update();
    }

    // ---- Geometry ----

    #layout() {
        const r = this.display.getBoundingClientRect();
        if (!r.width) return;
        this.w = r.width;
        this.h = r.height;
        this.svg.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);
        this.grid.replaceChildren();
        for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
            const x = this.x(hz);
            svg('line', { x1: x, x2: x, y1: 0, y2: this.h }, this.grid);
            svg('text', { x, y: this.h - 6, 'text-anchor': 'middle' }, this.grid).textContent = hz < 1000 ? hz : `${hz / 1000}k`;
        }
        for (let db = -12; db <= 12; db += 6) {
            const y = this.y(db);
            svg('line', { x1: 0, x2: this.w, y1: y, y2: y, class: db ? '' : 'zero' }, this.grid);
            svg('text', { x: this.w - 6, y: y - 4, 'text-anchor': 'end' }, this.grid).textContent = db > 0 ? `+${db}` : `${db}`;
        }
        this.update();
    }

    x(hz) { return Math.log(hz / 20) / Math.log(1000) * this.w; }
    hzAt(x) { return 20 * Math.pow(1000, x / this.w); }
    y(db) { const half = this.h / 2 - 12; return this.h / 2 - clamp(db, -DB_RANGE * 1.1, DB_RANGE * 1.1) / DB_RANGE * half; }
    dbAt(y) { const half = this.h / 2 - 12; return (this.h / 2 - y) / half * DB_RANGE; }
    yLevel(dbfs) { return clamp(dbfs / FLOOR, 0, 1) * this.h; }

    #nodeAt(x, y) {
        let best = -1, bestD = 11 * 11;
        for (let b = 0; b < BANDS; b++) {
            const s = this.band(b);
            if (!s.used) continue;
            const d = (this.x(s.freq) - x) ** 2 + (this.y(hasGain(s.type) ? s.gain : 0) - y) ** 2;
            if (d <= bestD) { bestD = d; best = b; }
        }
        return best;
    }

    #bindDisplay() {
        const local = (e) => { const r = this.svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        let drag = -1;
        this.svg.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const [x, y] = local(e);
            const b = this.#nodeAt(x, y);
            if (b < 0) return;
            if (b !== this.selected) this.#select(b);
            drag = b;
            this.svg.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        this.svg.addEventListener('pointermove', (e) => {
            if (drag < 0) return;
            const [x, y] = local(e);
            this.fx.set(id(drag, 'freq'), clamp(this.hzAt(x), 10, 30000));
            if (hasGain(this.band(drag).type)) this.fx.set(id(drag, 'gain'), clamp(this.dbAt(y), -30, 30));
            this.rack.update();
        });
        const end = () => { drag = -1; };
        this.svg.addEventListener('pointerup', end);
        this.svg.addEventListener('pointercancel', end);
        this.svg.addEventListener('dblclick', (e) => {
            const [x, y] = local(e);
            const b = this.#nodeAt(x, y);
            if (b >= 0) {
                this.fx.set(id(b, 'used'), 0);
                if (b === this.selected) this.#select(-1);
            } else this.#add(x, y);
            this.rack.update();
        });
        this.svg.addEventListener('wheel', (e) => {
            const [x, y] = local(e);
            let b = this.#nodeAt(x, y);
            if (b < 0) b = this.selected;
            if (b < 0 || this.band(b).type === TILT) return;
            e.preventDefault();
            const q = id(b, 'q');
            this.#set(q, clamp(this.fx.get(q) * Math.pow(2, -Math.sign(e.deltaY) * (e.shiftKey ? 0.05 : 0.2)), 0.025, 40));
        }, { passive: false });
    }

    #add(x, y) {
        let b = 0;
        while (b < BANDS && this.band(b).used) b++;
        if (b === BANDS) return;
        const hz = this.hzAt(x);
        const type = hz < 40 ? LOW_CUT : hz > 12000 ? HIGH_CUT : BELL;
        this.fx.set(id(b, 'type'), type);
        this.fx.set(id(b, 'freq'), clamp(hz, 10, 30000));
        this.fx.set(id(b, 'gain'), type === BELL ? clamp(this.dbAt(y), -30, 30) : 0);
        this.fx.set(id(b, 'q'), type === BELL ? 1 : 0.70710678);
        this.fx.set(id(b, 'range'), 0);
        this.fx.set(id(b, 'bypass'), 0);
        this.fx.set(id(b, 'used'), 1); // last: the band appears with its settings
        this.#select(b);
    }

    // ---- Updates ----

    // After a change: the band panel.
    update() {
        if (this.selected >= 0 && !this.band(this.selected).used) return this.#select(-1);
        this.globals.forEach((c) => c.update());
        if (this.selected < 0) return;
        const s = this.band(this.selected);
        this.title.textContent = `BAND ${this.selected + 1}`;
        this.typeBtn.textContent = TYPES[s.type];
        this.stereoBtn.textContent = STEREO[s.stereo];
        this.stereoBtn.classList.toggle('on', s.stereo !== 0);
        this.bypassBtn.classList.toggle('on', s.bypass);
        const applies = { freq: true, gain: hasGain(s.type), q: s.type !== TILT, slope: hasSlope(s.type), range: hasGain(s.type), threshold: hasGain(s.type) };
        this.knobs.forEach((k, i) => { k.update(); k.root.classList.toggle('dim', !applies[KNOBS[i][0]]); });
    }

    // Every frame: analyzer, curves and nodes.
    draw() {
        if (!this.w) return;
        const fx = this.fx, ex = fx.exports, m = fx.meter;
        const mode = Math.round(fx.get(G.analyzer)); // Off, Pre, Post, Pre+Post
        const spectrum = (offset) => {
            if (!m) return '';
            let d = `M0,${this.h}`;
            for (let c = 0; c < COLS; c++) d += `L${this.x(20 * Math.pow(1000, c / (COLS - 1))).toFixed(1)},${this.yLevel(m[offset + c]).toFixed(1)}`;
            return `${d}L${this.w},${this.h}Z`;
        };
        this.pre.setAttribute('d', mode === 1 || mode === 3 ? spectrum(0) : '');
        this.post.setAttribute('d', mode === 2 || mode === 3 ? spectrum(COLS) : '');

        // Curves from the plugin's designs, with the dynamic bands where they are now
        const dyn = new Float32Array(ex.memory.buffer, this.dynPtr, BANDS);
        for (let b = 0; b < BANDS; b++) dyn[b] = m ? m[2 * COLS + b] : 0;
        ex.contour_curves(fx.inst, this.dynPtr, this.curvesPtr, N);
        const c = new Float32Array(ex.memory.buffer, this.curvesPtr, (2 + 2 * BANDS) * N);
        const xi = (i) => (i / (N - 1) * this.w).toFixed(1);
        const line = (offset) => Array.from({ length: N }, (_, i) => `${i ? 'L' : 'M'}${xi(i)},${this.y(c[offset + i]).toFixed(1)}`).join('');
        const area = (top, bottom) => {
            let d = '';
            for (let i = 0; i < N; i++) d += `${i ? 'L' : 'M'}${xi(i)},${this.y(c[top + i]).toFixed(1)}`;
            for (let i = N - 1; i >= 0; i--) d += `L${xi(i)},${bottom === null ? this.y(0).toFixed(1) : this.y(c[bottom + i]).toFixed(1)}`;
            return `${d}Z`;
        };
        this.curve.setAttribute('d', line(0));
        let dynamic = false;
        this.reach.replaceChildren();
        for (let b = 0; b < BANDS; b++) {
            const s = this.band(b);
            const r = fx.get(id(b, 'range'));
            if (s.used && !s.bypass && r !== 0 && hasGain(s.type)) {
                dynamic = true;
                svg('path', { d: area((2 + b) * N, (2 + BANDS + b) * N) }, this.reach);
            }
        }
        this.live.setAttribute('d', dynamic ? line(N) : '');
        const sel = this.selected >= 0 ? this.band(this.selected) : null;
        this.fill.setAttribute('d', sel && !sel.bypass ? area((2 + this.selected) * N, null) : '');

        // Nodes
        this.nodes.replaceChildren();
        for (let b = 0; b < BANDS; b++) {
            const s = this.band(b);
            if (!s.used) continue;
            const g = svg('g', { class: `eq-node${b === this.selected ? ' sel' : ''}${s.bypass ? ' off' : ''}`, transform: `translate(${this.x(s.freq).toFixed(1)},${this.y(hasGain(s.type) ? s.gain : 0).toFixed(1)})` }, this.nodes);
            svg('circle', { r: 8.5 }, g);
            svg('text', { 'text-anchor': 'middle', dy: '0.35em' }, g).textContent = b + 1;
        }
    }
}
