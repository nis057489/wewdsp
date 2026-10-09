// A popup list of choices, as in the plugins (libs/wew_gui/include/wew/gui/menu.hpp): opened
// from a button (a dropdown) or at the cursor (a right-click menu) inside `container`, which
// must be positioned, so it moves with the page. Choosing, clicking anywhere else or Escape
// closes it.

import { h } from './dom.js';

let open = null; // { el, close }

export function closeMenu() { open?.close(); }

// items: [{ label, checked, heading, rule, icon (an element), action }]
// at: { from: element } below the element (above it if it doesn't fit), or { x, y } in client
// coordinates. onclose: after it closes, chosen or not.
export function openMenu(container, items, at, onclose) {
    closeMenu();
    const el = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
        if (it.rule) el.append(h('div', { class: 'menu-rule' }));
        if (it.heading) { el.append(h('div', { class: 'menu-heading' }, it.label)); continue; }
        el.append(h('button', {
            class: `menu-item${it.checked ? ' on' : ''}`, role: 'menuitemradio', 'aria-checked': it.checked ? 'true' : 'false',
            onclick: () => { close(); it.action(); },
        }, h('span', { class: 'menu-icon' }, it.icon || ''), h('span', { class: 'menu-label' }, it.label)));
    }
    container.append(el);

    // Place it inside the container
    const box = container.getBoundingClientRect(), m = el.getBoundingClientRect();
    let x, y;
    if (at.from) {
        const r = at.from.getBoundingClientRect();
        el.style.minWidth = `${r.width}px`;
        x = r.left;
        y = r.bottom + 4 + m.height <= box.bottom ? r.bottom + 4 : r.top - 4 - m.height;
    } else {
        x = at.x + 2 + m.width <= box.right ? at.x + 2 : at.x - m.width;
        y = at.y + 2 + m.height <= box.bottom ? at.y + 2 : at.y - m.height;
    }
    const w = el.getBoundingClientRect().width;
    x = Math.max(box.left + 4, Math.min(x, box.right - 4 - w));
    y = Math.max(box.top + 4, Math.min(y, box.bottom - 4 - m.height));
    el.style.left = `${x - box.left}px`;
    el.style.top = `${y - box.top}px`;

    // A press outside only closes it, as in the plugins: that press's click is swallowed too
    const outside = (e) => {
        if (el.contains(e.target)) return;
        close();
        e.stopPropagation();
        e.preventDefault();
        const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
        document.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallow, true), 600);
    };
    const key = (e) => { if (e.key === 'Escape') close(); };
    function close() {
        if (open?.el !== el) return;
        open = null;
        el.remove();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', key, true);
        window.removeEventListener('resize', close);
        onclose?.();
    }
    open = { el, close };
    // Listen from the next event on, so the press that opened it doesn't close it
    setTimeout(() => {
        if (open?.el !== el) return;
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', key, true);
        window.addEventListener('resize', close);
    });
    el.querySelector('.menu-item.on, .menu-item')?.focus({ preventScroll: true });
    return close;
}
