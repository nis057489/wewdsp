// Draws and edits a breakpoint shape (a WewShape from libs/wew_web/js/wew-effect.js), like the
// plugins' editor (libs/wew_gui/src/shape_editor.cpp): drag points (Shift snaps), drag the
// small handles to bend segments, double-click to add or remove a point or straighten a
// segment. Used by the LFO tab and Shaper's curves.

import { h } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';
const INSET = 8; // points stay clear of the editor's edge

export function svg(tag, attrs = {}, parent) {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
}

export class ShapeEditor {
    // onchange: after an edit. Layers, bottom to top: under (for a scope), the grid, ghost (a
    // reference curve), the shape's fill and line, the playhead, then its handles and points.
    constructor(onchange, title) {
        this.onchange = onchange;
        this.shape = null;
        this.el = h('div', { class: 'shape-editor', title: title || 'Drag points · drag the small handles to bend · double-click to add or remove a point · Shift snaps' });
        this.svg = svg('svg', { class: 'shape-svg' });
        this.under = svg('g', {}, this.svg);
        this.grid = svg('g', { class: 'shape-grid' }, this.svg);
        this.ghost = svg('path', { class: 'shape-ghost' }, this.svg);
        this.fill = svg('path', { class: 'shape-fill' }, this.svg);
        this.curve = svg('path', { class: 'shape-curve' }, this.svg);
        this.head = svg('line', { class: 'shape-head' }, this.svg);
        this.headDot = svg('circle', { class: 'shape-head-dot', r: 3.5 }, this.svg);
        this.handles = svg('g', {}, this.svg);
        this.points = svg('g', {}, this.svg);
        this.el.append(this.svg);
        this.#bind();
        new ResizeObserver(() => this.render()).observe(this.el);
    }

    // The shape to edit (null: show nothing editable), and an optional reference curve.
    setShape(shape, ghost = null) {
        this.shape = shape;
        this.ghostShape = ghost;
        this.render();
    }

    px(x) { return INSET + x * (this.w - 2 * INSET); }
    py(y) { return this.h - INSET - y * (this.h - 2 * INSET); }
    #sx(px) { return Math.min(1, Math.max(0, (px - INSET) / (this.w - 2 * INSET))); }
    #sy(py) { return Math.min(1, Math.max(0, (this.h - INSET - py) / (this.h - 2 * INSET))); }

    #path(shape) {
        const steps = Math.round(this.w);
        let d = '';
        for (let i = 0; i <= steps; i++) {
            const x = i / steps;
            d += `${i ? 'L' : 'M'}${this.px(x).toFixed(1)},${this.py(shape.value(x)).toFixed(1)}`;
        }
        return d;
    }

    render() {
        const r = this.el.getBoundingClientRect();
        if (!r.width) return;
        this.w = r.width;
        this.h = r.height;
        this.svg.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);

        this.grid.replaceChildren();
        for (const x of [0.25, 0.5, 0.75]) svg('line', { x1: this.px(x), x2: this.px(x), y1: 0, y2: this.h }, this.grid);
        svg('line', { x1: 0, x2: this.w, y1: this.py(0.5), y2: this.py(0.5) }, this.grid);

        this.ghost.setAttribute('d', this.ghostShape ? this.#path(this.ghostShape) : '');
        this.handles.replaceChildren();
        this.points.replaceChildren();
        this.head.style.display = this.headDot.style.display = this.shape ? '' : 'none';
        if (!this.shape) {
            this.curve.setAttribute('d', '');
            this.fill.setAttribute('d', '');
            this.pts = [];
            return;
        }
        const d = this.#path(this.shape);
        this.curve.setAttribute('d', d);
        this.fill.setAttribute('d', `${d}L${this.px(1)},${this.py(0)}L${this.px(0)},${this.py(0)}Z`);
        this.head.setAttribute('y1', 2);
        this.head.setAttribute('y2', this.h - 2);

        this.pts = this.shape.points();
        this.pts.forEach((p, i) => {
            const q = this.pts[i + 1];
            if (q && q.x > p.x) {
                const mx = (p.x + q.x) / 2;
                svg('circle', { class: 'shape-handle', r: 3, cx: this.px(mx), cy: this.py(this.shape.value(mx)) }, this.handles);
            }
            svg('circle', { class: 'shape-point', r: 4.5, cx: this.px(p.x), cy: this.py(p.y) }, this.points);
        });
    }

    // Every frame: the playhead (idle: dimmed).
    playhead(phase, idle = false) {
        if (!this.shape || !this.w) return;
        const x = this.px(phase);
        this.head.setAttribute('x1', x);
        this.head.setAttribute('x2', x);
        this.headDot.setAttribute('cx', x);
        this.headDot.setAttribute('cy', this.py(this.shape.value(phase)));
        this.el.classList.toggle('idle', idle);
    }

    // What's under (x, y): {point} or {handle}, or null.
    #hit(x, y) {
        let best = null, bestD = 9 * 9;
        this.pts.forEach((p, i) => {
            const d = (this.px(p.x) - x) ** 2 + (this.py(p.y) - y) ** 2;
            if (d <= bestD) { bestD = d; best = { point: i }; }
        });
        if (best) return best;
        for (let i = 0; i + 1 < this.pts.length; i++) {
            const p = this.pts[i], q = this.pts[i + 1];
            if (q.x <= p.x) continue;
            const mx = (p.x + q.x) / 2;
            if ((this.px(mx) - x) ** 2 + (this.py(this.shape.value(mx)) - y) ** 2 <= 8 * 8) return { handle: i };
        }
        return null;
    }

    #bind() {
        const local = (e) => {
            const r = this.svg.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        };
        let drag = null;
        this.svg.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !this.shape) return;
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
                this.shape.move(drag.point, sx, sy);
            } else {
                const up = (drag.y - y) / 60; // dragging up bows the segment upwards
                this.shape.bend(drag.handle, drag.curve + (drag.rising ? -up : up));
            }
            this.render();
            this.onchange();
        });
        const end = () => { drag = null; };
        this.svg.addEventListener('pointerup', end);
        this.svg.addEventListener('pointercancel', end);
        this.svg.addEventListener('dblclick', (e) => {
            if (!this.shape) return;
            const [x, y] = local(e);
            const hit = this.#hit(x, y);
            if (hit?.point !== undefined) this.shape.remove(hit.point);
            else if (hit?.handle !== undefined) this.shape.bend(hit.handle, 0);
            else this.shape.insert(this.#sx(x), this.#sy(y));
            this.render();
            this.onchange();
        });
    }
}
