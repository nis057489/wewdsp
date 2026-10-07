// Words and editor layout for each plugin. Name, version, tagline, category and status come
// from plugins/<slug>/plugin.json (via plugins.json, written by scripts/site.sh); a plugin
// with no entry here still gets a section, with knobs for all of its parameters.

export const ORDER = ['garble', 'keyfield', 'constellate', 'conform'];

export const SITE = {
    title: 'wewdsp',
    lede: 'Strange, free audio plugins. Play with them right here in the browser, then take them home to your DAW.',
    credit: 'Made by wew',
    contact: 'hello@nbembedded.com',
};

const BLUE = '#7ab3e0';
const GOLD = '#d4af37';

export const PLUGINS = {
    garble: {
        accent: BLUE,
        subtitle: 'WAVECRUSHER',
        blurb: [
            'Garble separates sound into layers of broad structure and fine detail, then lets you crush, quantise, or remove those layers independently.',
            'It started life as a compression algorithm for robots talking over bad networks. It is close to bitcrushing in spirit, but the failure mode is different: fine texture falls away while the contour and energy of the sound survive.',
        ],
        points: [
            ['Not normal bitcrushing', 'A Haar wavelet transform splits the audio into resolutions; Garble damages that representation and decodes what is left.'],
            ['Detail disappears by scale', 'Push it and drums fracture into sparse transients, synths go hollow, dense mixes keep only their strongest movements.'],
        ],
        viz: 'prism',
        columns: 3,
        controls: [
            { param: 'Level', label: 'Levels' },
            { param: 'Quantise' },
            { param: 'Ratio' },
            { param: 'Dry/Wet' },
            { param: 'Lo Band' },
            { param: 'Hi Band' },
        ],
        examples: [
            ['Amen break', 'sounds/garble amen.mp3'],
            ['Bass — Dank Reese Boi', 'sounds/Bass - Dank Reese Boi - Garbled.flac'],
            ['FX — Glorp Intel', 'sounds/FX - Glorp Intel - Garbled.flac'],
            ['Synth — Happy Socks', 'sounds/Synth - Happy Socks - Garbled.flac'],
            ['Synth — Xylo Lulls', 'sounds/Synth - Xylo Lulls - Garbled.flac'],
        ],
        source: 'drums',
    },
    keyfield: {
        accent: GOLD,
        subtitle: 'SPECTRAL KEY QUANTIZER',
        blurb: [
            'A MIDI scale quantizer snaps notes into key. Keyfield does that to every frequency in the signal, so it works on anything: vocals, pads, drums, noise.',
            'Each spectral peak and the bins around it move as one block onto the nearest in-key pitch, with phase-locked resynthesis. Click the keys to build your own scale.',
        ],
        points: [
            ['Anything becomes tonal', 'Run noise or a drum loop through it and hear chords appear. Try the Glide source and listen to it step through the scale.'],
            ['Colour past 100 %', 'Up to 100 % Color is a dry/wet mix; beyond it, resonant filtering pulls the sound further into key.'],
        ],
        viz: 'spectrum',
        piano: true,
        columns: 6,
        header: [{ param: 'FFT Size', kind: 'cycle', prefix: 'FFT ', reprepare: true }],
        controls: [
            { param: 'Root' },
            { param: 'Scale' },
            { param: 'Strength' },
            { param: 'Color' },
            { param: 'Low', log: true },
            { param: 'High', log: true },
            { param: 'Morph' },
            { param: 'Gate' },
            { param: 'Fine' },
            { param: 'Shift' },
            { param: 'Gain' },
            { param: 'Mute Sidebands', label: 'Mute Sides', kind: 'toggle' },
        ],
        source: 'glide',
    },
    constellate: {
        accent: BLUE,
        subtitle: 'SPECTRAL CONSTELLATION QUANTIZER',
        blurb: [
            'Constellate treats every FFT bin as a point on a radio receiver\'s IQ diagram and snaps it onto a QAM constellation grid, the way digital modems pack bits into a carrier.',
            'Low orders turn sound into a handful of hard-edged states; high orders are nearly transparent. Cluster blends between clean snapping and a scattered, gated cloud.',
        ],
        points: [
            ['Order', '2-QAM to 256-QAM: the resolution of the grid every bin is forced onto.'],
            ['Cluster', 'At 100 % bins snap cleanly. Lower, they scatter in blue noise and fade toward silence when far from a grid point.'],
        ],
        viz: 'constellation',
        columns: 3,
        controls: [{ param: 'Order' }, { param: 'Cluster' }, { param: 'Dry/Wet' }],
        source: 'chords',
    },
    conform: {
        accent: GOLD,
        subtitle: 'TONAL BALANCE REFERENCE',
        blurb: [
            'Put Conform on your master bus and it draws the long-term spectrum of the mix over a target band: pink noise, or reference tracks you load. Audio passes through untouched.',
            'Save references to a library and load them in any project. Solo a region to hear just the lows or the air. In the plugin, the analysis runs on the reference tracks themselves; this page shows a browser preview of the Fine view against pink noise.',
        ],
        points: [
            ['Compare by shape', 'Both curves are offset so their 50 Hz–10 kHz average sits at 0 dB, so you never have to match loudness with the reference.'],
            ['Broad, Fine and Stereo', 'One meter per region, a 1/6-octave curve, or stereo width across the spectrum against your references.'],
        ],
        viz: 'conform',
        wide: true,
        columns: 0,
        footer: [
            { param: 'Speed', kind: 'cycle', prefix: 'Speed: ' },
            { param: 'Tolerance', kind: 'drag', prefix: 'Tolerance ' },
            { kind: 'reset' },
        ],
        controls: [],
        source: 'drums',
    },
};

// Install notes per platform, shown under Download.
export const INSTALL = {
    macos: {
        label: 'macOS',
        steps: [
            'Unzip the download. You get <code>.clap</code> and <code>.vst3</code> plugins.',
            'In Finder press <kbd>Shift ⌘ G</kbd> and go to <code>~/Library/Audio/Plug-Ins/</code>. Drag the <code>.clap</code> into <code>CLAP</code> and the <code>.vst3</code> into <code>VST3</code> (create the folder if it is missing).',
            'The plugins aren\'t notarized by Apple, so macOS blocks them at first. Open Terminal and run this once: <pre>xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/CLAP/*.clap ~/Library/Audio/Plug-Ins/VST3/*.vst3</pre>',
            'Rescan plugins in your DAW. Universal: Apple Silicon and Intel, macOS 11 or later.',
        ],
    },
    windows: {
        label: 'Windows',
        steps: [
            'Extract the zip.',
            'Copy the <code>.clap</code> files to <code>C:\\Program Files\\Common Files\\CLAP</code> and the <code>.vst3</code> files to <code>C:\\Program Files\\Common Files\\VST3</code>.',
            'Rescan plugins in your DAW. 64-bit Windows 10 or later.',
        ],
    },
    linux: {
        label: 'Linux',
        steps: [
            'Extract the zip.',
            'Copy the <code>.clap</code> files to <code>~/.clap</code> and the <code>.vst3</code> folders to <code>~/.vst3</code>: <pre>mkdir -p ~/.clap ~/.vst3 && cp -r *.clap ~/.clap && cp -r *.vst3 ~/.vst3</pre>',
            'Rescan plugins in your DAW. x86_64, needs X11 and OpenGL.',
        ],
    },
};

export const HOSTS = 'CLAP: Bitwig, REAPER, FL Studio 21+, Studio One · VST3: Ableton Live, Cubase and most other hosts';
