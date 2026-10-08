// DOM helpers shared by the page and the editors.

export function h(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.entries(v).forEach(([p, val]) => e.style.setProperty(p, val));
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
}

// "Garble" with its accent letter (index 1, as in the editors)
export function wordmark(name, accent = 1, cls = 'wordmark') {
    return h('span', { class: cls }, name.slice(0, accent), h('em', {}, name.slice(accent, accent + 1)), name.slice(accent + 1));
}
