// Builds the page from plugins.json (scripts/site.sh), content.js and the download manifest.

import { ORDER, PLUGINS, SITE, INSTALL, HOSTS } from './content.js';
import { Engine, SOURCES } from './audio.js';
import { Knob, Toggle, Cycle, DragButton, Piano } from './controls.js';
import { Spectra, SpectrumViz, PrismViz, ConstellationViz, ConformViz, HeroViz } from './viz.js';

const engine = new Engine();
const spectra = new Spectra(engine);
const racks = new Map(); // slug -> Rack
const visible = new Set(); // canvases on screen
let userPickedSource = false;

const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs = {}, ...children) {
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
function wordmark(name, accent = 1, cls = 'wordmark') {
    return h('span', { class: cls }, name.slice(0, accent), h('em', {}, name.slice(accent, accent + 1)), name.slice(accent + 1));
}

function detectOS() {
    const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
    if (/win/.test(p)) return 'windows';
    if (/linux|x11|cros|android/.test(p)) return 'linux';
    return 'macos';
}

const fmtSize = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

async function json(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

class Rack {
    constructor(plugin, cfg) {
        this.plugin = plugin;
        this.cfg = cfg;
        this.slug = plugin.slug;
        this.controls = [];
        this.el = h('article', { class: 'rack', style: { '--accent': cfg.accent }, 'aria-label': `${plugin.name} editor` });
        this.el.append(h('div', { class: 'rack-loading' }, 'Loading DSP…'));
    }

    async build() {
        const fx = await engine.effect(this.slug);
        this.fx = fx;
        const { plugin, cfg } = this;
        const onchange = () => this.update();
        this.el.replaceChildren();

        if (cfg.viz === 'prism') {
            this.canvas = h('canvas', { class: 'rack-prism', 'aria-hidden': 'true' });
            this.el.append(this.canvas);
        }
        this.play = h('button', { class: 'rack-play', onclick: () => togglePlay(this.slug), 'aria-label': `Play through ${plugin.name}` },
            h('span', { class: 'icon' }), h('span', { class: 'rack-play-text' }, 'Play'));
        const headRight = h('div', { class: 'rack-head-right' });
        for (const c of cfg.header || []) this.#control(headRight, c, onchange);
        headRight.append(this.play);
        this.el.append(h('header', { class: 'rack-head' },
            h('div', {}, wordmark(plugin.name, 1, 'wordmark rack-wordmark'), h('div', { class: 'rack-sub' }, cfg.subtitle || plugin.tagline.toUpperCase())),
            headRight));

        if (cfg.viz !== 'prism') {
            this.canvas = h('canvas', { class: `rack-viz viz-${cfg.viz || 'spectrum'}`, 'aria-hidden': 'true' });
            this.el.append(this.canvas);
        }
        if (cfg.piano) this.piano = new Piano(this.el, fx, onchange);

        if (cfg.columns !== 0) {
            const grid = h('div', { class: 'rack-grid', style: { '--cols': cfg.columns || 3 } });
            const controls = cfg.controls?.length ? cfg.controls
                : fx.info.params.map((p) => ({ param: p.name })); // any plugin: one knob per parameter
            for (const c of controls) this.#control(grid, c, onchange);
            this.el.append(grid);
        }
        if (cfg.footer) {
            this.note = h('span', { class: 'rack-bar-note' });
            const bar = h('div', { class: 'rack-bar' }, this.note);
            const right = h('div', { class: 'rack-bar-right' });
            for (const c of cfg.footer) this.#control(right, c, onchange);
            bar.append(right);
            this.el.append(bar);
        }
        this.el.append(h('footer', { class: 'rack-foot' }, h('span', {}, `V${plugin.version}`), h('span', {}, SITE.credit)));

        const accent = cfg.accent;
        switch (cfg.viz) {
            case 'prism': this.viz = new PrismViz(this.canvas, fx); break;
            case 'constellation': this.viz = new ConstellationViz(this.canvas, spectra, fx, accent); break;
            case 'conform': this.viz = new ConformViz(this.canvas, fx); break;
            default:
                this.viz = new SpectrumViz(this.canvas, spectra, accent, {
                    keyMask: this.piano ? () => this.piano.mask() : null,
                    labels: this.piano ? ['DRY', 'TUNED'] : ['DRY', 'WET'],
                });
        }
        if (cfg.target && this.viz.loadTarget) {
            // Start on the reference target, as if it had been loaded from the library
            await this.viz.loadTarget(cfg.target).then(() => fx.set(fx.paramId('Target'), 1)).catch(showError);
        }
        observe(this.canvas);
        this.update();
    }

    #control(parent, c, onchange) {
        if (c.kind === 'reset') {
            const b = h('button', { class: 'pill-btn icon-btn', title: 'Restart the long-term average', 'aria-label': 'Reset average',
                onclick: () => this.viz.reset?.() }, '↻');
            parent.append(b);
            return;
        }
        const id = this.fx.paramId(c.param);
        if (id < 0) return;
        const Kind = { toggle: Toggle, cycle: Cycle, drag: DragButton }[c.kind] || Knob;
        this.controls.push(new Kind(parent, this.fx, id, c, onchange));
    }

    update() {
        this.controls.forEach((c) => c.update());
        this.piano?.update();
        if (this.note && this.viz?.note) this.note.textContent = this.viz.note();
        const on = engine.active === this.slug && engine.playing;
        this.el.classList.toggle('active', engine.active === this.slug);
        this.play.classList.toggle('on', on);
        $('.rack-play-text', this.play).textContent = on ? 'Stop' : 'Play';
        this.play.setAttribute('aria-label', `${on ? 'Stop' : 'Play through'} ${this.plugin.name}`);
    }

    draw() {
        if (this.viz && visible.has(this.canvas)) this.viz.draw(engine.active === this.slug);
    }
}

async function togglePlay(slug) {
    try {
        if (engine.active === slug && engine.playing) {
            engine.stop();
            return;
        }
        if (!userPickedSource && engine.sourceId !== 'file') {
            engine.sourceId = PLUGINS[slug]?.source || 'drums';
        }
        await engine.activate(slug);
        if (!(await engine.play())) pickFile();
    } catch (err) {
        showError(err);
    }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderHero(plugins, manifest) {
    const os = detectOS();
    const bundle = manifest?.bundles?.[os];
    $('#hero-content').append(
        h('h1', { class: 'hero-title' }, wordmark(SITE.title, 1)),
        h('p', { class: 'hero-lede' }, SITE.lede),
        h('div', { class: 'hero-cta' },
            h('a', { class: 'btn btn-primary', href: `#${plugins[0].slug}` }, 'Try them now'),
            bundle ? h('a', { class: 'btn btn-ghost', href: '#download' }, `Download for ${INSTALL[os].label}`) : null),
        h('ul', { class: 'hero-chips' }, plugins.map((p) =>
            h('li', {}, h('a', { href: `#${p.slug}`, style: { '--accent': (PLUGINS[p.slug] || {}).accent || '#d4af37' } },
                h('strong', {}, p.name), h('span', {}, p.tagline))))),
    );
    const hero = new HeroViz($('#hero-canvas'), spectra);
    observe(hero.canvas);
    return hero;
}

function downloadLinks(plugin, manifest, base) {
    const dl = manifest?.plugins?.find((p) => p.slug === plugin.slug)?.downloads;
    if (!dl) return h('p', { class: 'muted small' }, 'Builds coming soon.');
    const os = detectOS();
    return h('div', { class: 'dl-row' },
        Object.keys(INSTALL).filter((k) => dl[k]).map((k) =>
            h('a', { class: `btn ${k === os ? 'btn-primary' : 'btn-ghost'} btn-sm`, href: base + dl[k].file, download: '' },
                INSTALL[k].label, h('span', { class: 'btn-meta' }, fmtSize(dl[k].bytes)))));
}

function renderPlugins(plugins, manifest, base) {
    const main = $('#plugins');
    plugins.forEach((p, i) => {
        const cfg = PLUGINS[p.slug] || { accent: '#d4af37', blurb: [p.description], columns: 3 };
        const rack = new Rack(p, cfg);
        racks.set(p.slug, rack);
        const copy = h('div', { class: 'plugin-copy' },
            h('p', { class: 'eyebrow' }, `${String(i + 1).padStart(2, '0')} — ${p.category || 'Effect'}`,
                p.status && p.status !== 'released' ? h('span', { class: 'badge' }, p.status) : null),
            h('h2', { class: 'plugin-title' }, wordmark(p.name)),
            h('p', { class: 'plugin-tagline' }, p.tagline),
            (cfg.blurb || []).map((t) => h('p', {}, t)),
            cfg.points ? h('dl', { class: 'points' }, cfg.points.map(([t, d]) => [h('dt', {}, t), h('dd', {}, d)])) : null,
            h('div', { class: 'plugin-dl' }, h('p', { class: 'label' }, `Download ${p.name} v${p.version} · CLAP + VST3`), downloadLinks(p, manifest, base)),
            h('details', { class: 'shot' },
                h('summary', {}, 'The editor in your DAW'),
                h('img', { src: `img/${p.slug}.png`, alt: `${p.name} editor`, loading: 'lazy' })),
            cfg.examples ? h('details', { class: 'examples' },
                h('summary', {}, 'Listen: examples run through Garble'),
                h('ul', {}, cfg.examples.map(([t, src]) => h('li', {}, h('span', {}, t), h('audio', { controls: true, preload: 'none', src }))))) : null,
        );
        main.append(h('section', { class: 'plugin', id: p.slug, style: { '--accent': cfg.accent } }, copy, h('div', { class: 'plugin-rack' }, rack.el)));
    });
}

function renderDownloads(plugins, manifest, base) {
    const root = $('#download-content');
    if (!manifest) {
        root.append(h('p', { class: 'muted' }, 'Release builds are on their way. Run scripts/package.sh to produce them.'));
        return;
    }
    let current = detectOS();
    const platforms = Object.keys(INSTALL).filter((k) => manifest.bundles?.[k]);
    if (!platforms.includes(current)) current = platforms[0];
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const panel = h('div', { class: 'tab-panel', role: 'tabpanel' });
    const show = (os) => {
        current = os;
        tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.os === os));
        const b = manifest.bundles[os];
        panel.replaceChildren(
            h('a', { class: 'btn btn-primary btn-lg', href: base + b.file, download: '' },
                `Download all ${plugins.length} plugins for ${INSTALL[os].label}`, h('span', { class: 'btn-meta' }, fmtSize(b.bytes))),
            h('table', { class: 'dl-table' }, h('tbody', {}, plugins.map((p) => {
                const d = manifest.plugins.find((m) => m.slug === p.slug)?.downloads?.[os];
                return h('tr', {},
                    h('td', {}, wordmark(p.name, 1, 'wordmark small')),
                    h('td', { class: 'muted' }, `v${p.version}`),
                    h('td', { class: 'muted' }, p.tagline),
                    h('td', {}, d ? h('a', { href: base + d.file, download: '', class: 'link' }, `.zip · ${fmtSize(d.bytes)}`) : '—'));
            }))),
            h('ol', { class: 'steps' }, INSTALL[os].steps.map((s) => h('li', { html: s }))),
        );
    };
    platforms.forEach((os) => tabs.append(h('button', { role: 'tab', 'data-os': os, onclick: () => show(os) }, INSTALL[os].label)));
    root.append(tabs, panel, h('p', { class: 'muted small hosts' }, HOSTS));
    show(current);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

let fileInput;
function pickFile() { fileInput.click(); }

function renderTransport(plugins) {
    fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: async () => {
        if (fileInput.files[0]) {
            userPickedSource = true;
            if (!engine.active) await engine.activate(plugins[0].slug);
            await engine.loadFile(fileInput.files[0]).catch(showError);
        }
    } });
    const play = h('button', { class: 'tp-play', 'aria-label': 'Play', onclick: async () => {
        if (engine.playing) return engine.stop();
        await togglePlay(engine.active || nearestPlugin());
    } }, h('span', { class: 'icon' }));
    const select = h('select', { class: 'tp-source', 'aria-label': 'Source', onchange: async () => {
        userPickedSource = true;
        if (select.value === 'file') return pickFile();
        await engine.setSource(select.value).catch(showError);
    } }, SOURCES.map((s) => h('option', { value: s.id }, s.label)));
    const through = h('span', { class: 'tp-through' });
    const bypass = h('button', { class: 'tp-bypass', 'aria-pressed': 'false', title: 'Hear the dry signal (latency matched)',
        onclick: () => engine.setBypass(!engine.bypassed) }, 'Bypass');
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, class: 'tp-vol', 'aria-label': 'Volume',
        oninput: () => engine.setVolume(+vol.value) });
    const meter = h('div', { class: 'tp-meter' }, h('span'));
    const bar = h('div', { class: 'transport', role: 'region', 'aria-label': 'Player' },
        play, h('label', { class: 'tp-field' }, h('span', { class: 'tp-label' }, 'Source'), select), through, bypass,
        h('label', { class: 'tp-field tp-vol-wrap' }, h('span', { class: 'tp-label' }, 'Vol'), vol), meter, fileInput);
    document.body.append(bar);

    engine.on(() => {
        play.classList.toggle('on', engine.playing);
        play.setAttribute('aria-label', engine.playing ? 'Stop' : 'Play');
        select.value = engine.sourceId;
        const fileOpt = select.querySelector('option[value="file"]');
        fileOpt.textContent = engine.fileName ? `File: ${engine.fileName}` : 'Your file…';
        const p = plugins.find((x) => x.slug === engine.active);
        through.replaceChildren(p ? h('span', {}, 'through ', h('a', { href: `#${p.slug}` }, p.name)) : '');
        bypass.classList.toggle('on', engine.bypassed);
        bypass.setAttribute('aria-pressed', engine.bypassed);
        bar.classList.toggle('live', engine.playing);
        racks.forEach((r) => r.fx && r.update());
    });
    return meter.firstChild;
}

// The plugin section closest to the middle of the screen.
function nearestPlugin() {
    let best = null, bestD = Infinity;
    racks.forEach((r, slug) => {
        const b = r.el.getBoundingClientRect();
        const d = Math.abs(b.top + b.height / 2 - innerHeight / 2);
        if (d < bestD) { bestD = d; best = slug; }
    });
    return best;
}

// Drop an audio file anywhere to play it.
function enableDrop(plugins) {
    let depth = 0;
    addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dropping'); } });
    addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dropping'); } });
    addEventListener('dragover', (e) => e.preventDefault());
    addEventListener('drop', async (e) => {
        e.preventDefault();
        depth = 0;
        document.body.classList.remove('dropping');
        const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('audio/') || /\.(wav|flac|mp3|ogg|m4a|aiff?)$/i.test(x.name));
        if (!f) return;
        userPickedSource = true;
        await engine.activate(engine.active || nearestPlugin() || plugins[0].slug);
        await engine.loadFile(f).catch(showError);
    });
}

function showError(err) {
    console.error(err);
    const t = h('div', { class: 'toast', role: 'alert' }, String(err.message || err));
    document.body.append(t);
    setTimeout(() => t.remove(), 6000);
}

// ---------------------------------------------------------------------------

const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
}, { rootMargin: '100px' });
function observe(el) { io.observe(el); }

async function main() {
    const [list, manifest] = await Promise.all([json('plugins.json'), json('downloads/manifest.json').catch(() => null)]);
    const plugins = [...list].sort((a, b) => {
        const ia = ORDER.indexOf(a.slug), ib = ORDER.indexOf(b.slug);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
    });
    const base = manifest?.base || 'downloads/';
    const hero = renderHero(plugins, manifest);
    renderPlugins(plugins, manifest, base);
    renderDownloads(plugins, manifest, base);
    const meterFill = renderTransport(plugins);
    enableDrop(plugins);
    $('#year').textContent = new Date().getFullYear();

    engine.init();
    await Promise.all([...racks.values()].map((r) => r.build().catch((err) => {
        r.el.replaceChildren(h('div', { class: 'rack-loading' }, `Couldn't load the DSP: ${err.message}`));
    })));
    engine.emit();

    let frame = 0;
    const loop = () => {
        frame++;
        spectra.update(frame);
        if (visible.has(hero.canvas)) hero.draw();
        racks.forEach((r) => r.draw());
        meterFill.style.transform = `scaleX(${spectra.live ? spectra.level : 0})`;
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

main().catch(showError);
