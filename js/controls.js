// Editor controls bound to a WewEffect parameter, drawn like the native editors
// (libs/wew_gui/src/widgets.cpp). Every value control behaves like the plugin's:
// vertical drag (150 px for the full range, 750 px with Shift), double-click resets to the
// default, and arrow keys / Page Up / Page Down / Home / End when focused.

const SVG = 'http://www.w3.org/2000/svg';

export function toNorm(p, v, log) {
    if (p.max <= p.min) return 0;
    const n = log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min);
    return Math.min(1, Math.max(0, n));
}

export function fromNorm(p, n, log) {
    n = Math.min(1, Math.max(0, n));
    let v = log ? p.min * Math.pow(p.max / p.min, n) : p.min + n * (p.max - p.min);
    if (p.flags & 1) v = Math.round(v);
    return Math.min(p.max, Math.max(p.min, v));
}

function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
}

function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
}

const START = Math.PI * 0.75;
const END = Math.PI * 2.25;

function arcPath(r, a0, a1) {
    const x0 = r * Math.cos(a0), y0 = r * Math.sin(a0);
    const x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
    return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

// Shared drag / keyboard / double-click behaviour for one parameter.
class ParamControl {
    constructor(fx, id, opts, onchange) {
        this.fx = fx;
        this.id = id;
        this.p = fx.param(id);
        this.log = !!opts.log;
        this.onchange = onchange;
    }

    norm() { return toNorm(this.p, this.fx.get(this.id), this.log); }

    set(v) {
        this.fx.set(this.id, v);
        this.onchange(this.id);
    }

    bindDrag(target) {
        let startY = 0, startNorm = 0, dragNorm = 0, active = false, fine = false;
        target.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            active = true;
            fine = e.shiftKey;
            startY = e.clientY;
            startNorm = dragNorm = this.norm();
            target.setPointerCapture(e.pointerId);
            target.classList.add('dragging');
            e.preventDefault();
        });
        target.addEventListener('pointermove', (e) => {
            if (!active) return;
            // Re-base when Shift changes so the value doesn't jump
            if (e.shiftKey !== fine) {
                fine = e.shiftKey;
                startNorm = dragNorm;
                startY = e.clientY;
            }
            dragNorm = Math.min(1, Math.max(0, startNorm + (startY - e.clientY) / (fine ? 750 : 150)));
            const v = fromNorm(this.p, dragNorm, this.log);
            if (v !== this.fx.get(this.id)) this.set(v);
        });
        const end = () => {
            active = false;
            target.classList.remove('dragging');
        };
        target.addEventListener('pointerup', end);
        target.addEventListener('pointercancel', end);
        target.addEventListener('dblclick', () => this.set(this.p.def));
        target.addEventListener('keydown', (e) => {
            const stepped = this.p.flags & 1;
            const fine = e.shiftKey ? 0.1 : 1;
            const step = stepped ? 1 : 0.01 * fine;
            const big = stepped ? Math.max(1, Math.round((this.p.max - this.p.min) / 10)) : 0.1 * fine;
            let v = null;
            const nudge = (d) => (stepped ? this.fx.get(this.id) + d : fromNorm(this.p, this.norm() + d, this.log));
            switch (e.key) {
                case 'ArrowUp': case 'ArrowRight': v = nudge(step); break;
                case 'ArrowDown': case 'ArrowLeft': v = nudge(-step); break;
                case 'PageUp': v = nudge(big); break;
                case 'PageDown': v = nudge(-big); break;
                case 'Home': v = this.p.min; break;
                case 'End': v = this.p.max; break;
                case 'Delete': case 'Backspace': v = this.p.def; break;
                default: return;
            }
            e.preventDefault();
            this.set(Math.min(this.p.max, Math.max(this.p.min, v)));
        });
        target.tabIndex = 0;
        target.setAttribute('role', 'slider');
        target.setAttribute('aria-valuemin', this.p.min);
        target.setAttribute('aria-valuemax', this.p.max);
    }

    aria(target) {
        target.setAttribute('aria-valuenow', this.fx.get(this.id));
        target.setAttribute('aria-valuetext', this.fx.format(this.id));
    }
}

export class Knob extends ParamControl {
    constructor(parent, fx, id, opts, onchange) {
        super(fx, id, opts, onchange);
        this.root = el('div', 'ctl knob', parent);
        const svg = svgEl('svg', { viewBox: '-24 -24 48 48', class: 'knob-svg', 'aria-hidden': 'true' }, this.root);
        svgEl('path', { d: arcPath(17, START, END), class: 'knob-track' }, svg);
        this.valueArc = svgEl('path', { class: 'knob-value' }, svg);
        svgEl('circle', { r: 11, class: 'knob-centre' }, svg);
        this.dot = svgEl('circle', { r: 1.8, class: 'knob-dot' }, svg);
        el('div', 'ctl-label', this.root).textContent = opts.label || this.p.name;
        this.value = el('div', 'ctl-value', this.root);
        this.root.setAttribute('aria-label', opts.label || this.p.name);
        this.root.title = 'Drag up/down (Shift for fine) · double-click to reset';
        this.bindDrag(this.root);
        this.update();
    }

    update() {
        const n = this.norm();
        const a = START + n * (END - START);
        this.valueArc.setAttribute('d', n > 0.001 ? arcPath(17, START, a) : '');
        this.dot.setAttribute('cx', (9 * Math.cos(a)).toFixed(3));
        this.dot.setAttribute('cy', (9 * Math.sin(a)).toFixed(3));
        this.value.textContent = this.fx.format(this.id);
        this.aria(this.root);
    }
}

export class Toggle extends ParamControl {
    constructor(parent, fx, id, opts, onchange) {
        super(fx, id, opts, onchange);
        this.root = el('div', 'ctl toggle', parent);
        this.btn = el('button', 'toggle-pill', this.root);
        this.btn.setAttribute('role', 'switch');
        this.btn.setAttribute('aria-label', opts.label || this.p.name);
        el('span', 'toggle-thumb', this.btn);
        el('div', 'ctl-label', this.root).textContent = opts.label || this.p.name;
        this.value = el('div', 'ctl-value', this.root);
        this.btn.addEventListener('click', () => this.set(this.fx.get(this.id) >= 0.5 ? this.p.min : this.p.max));
        this.update();
    }

    update() {
        const on = this.fx.get(this.id) >= 0.5;
        this.btn.classList.toggle('on', on);
        this.btn.setAttribute('aria-checked', on);
        this.value.textContent = this.fx.format(this.id);
    }
}

// Button that steps through a stepped parameter's values (Keyfield's FFT size, Conform's speed).
export class Cycle extends ParamControl {
    constructor(parent, fx, id, opts, onchange) {
        super(fx, id, opts, onchange);
        this.prefix = opts.prefix || '';
        this.reprepare = !!opts.reprepare;
        this.root = el('button', 'pill-btn', parent);
        this.root.addEventListener('click', () => {
            const v = this.fx.get(this.id) + 1;
            this.set(v > this.p.max ? this.p.min : v);
            if (this.reprepare) this.fx.prepare();
        });
        this.update();
    }

    update() { this.root.textContent = this.prefix + this.fx.format(this.id); }
}

// Button whose value is dragged like a knob (Conform's Tolerance).
export class DragButton extends ParamControl {
    constructor(parent, fx, id, opts, onchange) {
        super(fx, id, opts, onchange);
        this.prefix = opts.prefix || '';
        this.root = el('div', 'pill-btn drag', parent);
        this.root.title = 'Drag up/down (Shift for fine) · double-click to reset';
        this.root.setAttribute('aria-label', this.p.name);
        this.bindDrag(this.root);
        this.update();
    }

    update() {
        this.root.textContent = this.prefix + this.fx.format(this.id);
        this.aria(this.root);
    }
}

// Keyfield's keyboard: shows the notes in key and edits a custom scale.
const SCALE_MASKS = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 5, 7, 9, 10],
    [0, 1, 3, 5, 6, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10],
    [0, 2, 3, 5, 6, 8, 9, 11], [0, 4, 7], [0, 3, 7], [0, 7], [0],
].map((iv) => iv.reduce((m, i) => m | (1 << i), 0));
const CUSTOM = SCALE_MASKS.length; // keyfield::kScaleCustom
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = [1, 3, 6, 8, 10];
const WHITE = [0, 2, 4, 5, 7, 9, 11];

export class Piano {
    constructor(parent, fx, onchange) {
        this.fx = fx;
        this.onchange = onchange;
        this.ids = { root: fx.paramId('Root'), scale: fx.paramId('Scale'), notes: fx.paramId('Notes') };
        this.root = el('div', 'piano', parent);
        this.root.setAttribute('role', 'group');
        this.root.setAttribute('aria-label', 'Notes in key');
        this.keys = [];
        WHITE.forEach((pc, i) => this.#key(pc, false, i));
        BLACK.forEach((pc) => this.#key(pc, true, WHITE.indexOf(pc - 1)));
        this.update();
    }

    #key(pc, black, whiteIndex) {
        const k = el('button', black ? 'key black' : 'key white', this.root);
        k.style.setProperty('--i', whiteIndex);
        k.setAttribute('aria-label', NAMES[pc]);
        if (!black) el('span', 'key-name', k).textContent = NAMES[pc];
        k.addEventListener('click', () => {
            // Start from what's audible, toggle the note, and switch to Custom (as the plugin does)
            this.fx.set(this.ids.notes, this.mask() ^ (1 << pc));
            this.fx.set(this.ids.scale, CUSTOM);
            this.onchange(this.ids.notes);
        });
        this.keys[pc] = k;
    }

    mask() {
        const scale = Math.round(this.fx.get(this.ids.scale));
        if (scale >= CUSTOM) return Math.round(this.fx.get(this.ids.notes)) & 0xfff;
        const root = Math.round(this.fx.get(this.ids.root)) % 12;
        const m = SCALE_MASKS[scale];
        return ((m << root) | (m >> (12 - root))) & 0xfff;
    }

    update() {
        const m = this.mask();
        const root = Math.round(this.fx.get(this.ids.root)) % 12;
        this.keys.forEach((k, pc) => {
            k.classList.toggle('on', !!(m & (1 << pc)));
            k.classList.toggle('root', pc === root);
            k.setAttribute('aria-pressed', !!(m & (1 << pc)));
        });
    }
}
