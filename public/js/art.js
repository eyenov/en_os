import { getScene } from './scenes.js';
import { hashString, mulberry32 } from './scoring.js';

/**
 * Procedural scene illustrations. Deterministic, dependency-free, and small:
 * one SVG per scene, animated only with CSS so it stays crisp on every screen.
 */
const BUILDERS = {
  music: (p) => `
    <circle cx="332" cy="150" r="86" fill="none" stroke="${p.accent}" stroke-width="1.2" opacity=".38"/>
    <circle cx="332" cy="150" r="62" fill="none" stroke="${p.accent}" stroke-width="1.2" opacity=".55"/>
    <circle cx="332" cy="150" r="40" fill="none" stroke="${p.accent}" stroke-width="1.2" opacity=".8"/>
    <circle cx="332" cy="150" r="8" fill="${p.accent}"/>
    <g stroke="${p.ink}" stroke-width="2" stroke-linecap="round" opacity=".8">
      <path d="M74 244v-42"/><path d="M96 244v-74"/><path d="M118 244v-96"/><path d="M140 244v-58"/><path d="M162 244v-112"/><path d="M184 244v-80"/><path d="M206 244v-46"/>
    </g>
    <g fill="${p.accent}" opacity=".85">
      <circle cx="252" cy="92" r="7"/><rect x="257" y="60" width="2.4" height="34" rx="1"/>
      <circle cx="404" cy="250" r="5.5"/><rect x="408" y="224" width="2.2" height="29" rx="1"/>
    </g>
    <path d="M40 300c60-26 120-26 180 0s120 26 180 0" fill="none" stroke="${p.accent}" stroke-width="1.4" opacity=".35"/>`,

  comic: (p) => `
    <g transform="rotate(-6 240 180)">
      <rect x="70" y="78" width="132" height="170" rx="8" fill="#fffdf8" stroke="${p.ink}" stroke-width="1.6" opacity=".95"/>
      <rect x="186" y="58" width="132" height="170" rx="8" fill="#fffdf8" stroke="${p.ink}" stroke-width="1.6" opacity=".95"/>
      <rect x="300" y="92" width="120" height="150" rx="8" fill="#fffdf8" stroke="${p.ink}" stroke-width="1.6" opacity=".95"/>
      <g stroke="${p.accent}" stroke-width="1.4" opacity=".7">
        <path d="M88 110h92"/><path d="M88 130h70"/><path d="M88 150h84"/>
        <path d="M204 92h92"/><path d="M204 112h62"/><path d="M204 132h84"/>
        <path d="M318 124h82"/><path d="M318 144h58"/>
      </g>
      <circle cx="258" cy="196" r="26" fill="${p.accent}" opacity=".22"/>
      <path d="M238 214l-8 26 24-14z" fill="${p.accent}" opacity=".22"/>
    </g>
    <g fill="${p.accent}" opacity=".35">
      <circle cx="52" cy="66" r="3"/><circle cx="70" cy="50" r="2"/><circle cx="438" cy="286" r="3"/><circle cx="420" cy="304" r="2"/>
    </g>`,

  sports: (p) => `
    <ellipse cx="240" cy="240" rx="188" ry="72" fill="none" stroke="${p.accent}" stroke-width="1.6" opacity=".45"/>
    <ellipse cx="240" cy="240" rx="150" ry="56" fill="none" stroke="${p.accent}" stroke-width="1.6" opacity=".55"/>
    <ellipse cx="240" cy="240" rx="112" ry="41" fill="none" stroke="${p.accent}" stroke-width="1.6" opacity=".7"/>
    <circle cx="240" cy="168" r="58" fill="#fffdf8" stroke="${p.ink}" stroke-width="2"/>
    <path d="M240 128v42l30 18" fill="none" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M240 110v-14" stroke="${p.accent}" stroke-width="4" stroke-linecap="round"/>
    <g stroke="${p.ink}" stroke-width="1.6" opacity=".35" stroke-linecap="round">
      <path d="M60 120h54"/><path d="M44 140h34"/><path d="M70 160h26"/>
      <path d="M362 96h58"/><path d="M382 116h42"/><path d="M394 136h28"/>
    </g>
    <path d="M96 292h74" stroke="${p.accent}" stroke-width="3" stroke-linecap="round" opacity=".6"/>`,

  science: (p) => `
    <g fill="none" stroke="${p.accent}" opacity=".5">
      <ellipse cx="250" cy="172" rx="118" ry="46" transform="rotate(-16 250 172)" stroke-width="1.4"/>
      <ellipse cx="250" cy="172" rx="88" ry="34" transform="rotate(24 250 172)" stroke-width="1.4"/>
      <circle cx="250" cy="172" r="26" fill="${p.accent}" opacity=".2" stroke="none"/>
    </g>
    <circle cx="250" cy="172" r="7" fill="${p.accent}"/>
    <circle cx="352" cy="134" r="4.5" fill="${p.ink}" opacity=".6"/>
    <circle cx="146" cy="206" r="3.5" fill="${p.ink}" opacity=".5"/>
    <g fill="${p.ink}" opacity=".55">
      <circle cx="84" cy="84" r="2.4"/><circle cx="116" cy="64" r="1.8"/><circle cx="404" cy="76" r="2.6"/>
      <circle cx="430" cy="112" r="1.8"/><circle cx="372" cy="294" r="2.2"/><circle cx="74" cy="286" r="2"/>
      <circle cx="196" cy="54" r="1.6"/><circle cx="320" cy="300" r="1.6"/>
    </g>
    <path d="M206 236l-34 70h70l-30-58" fill="none" stroke="${p.ink}" stroke-width="1.8" opacity=".6"/>
    <path d="M214 248h72" stroke="${p.accent}" stroke-width="5" stroke-linecap="round" opacity=".7"/>`,

  travel: (p) => `
    <circle cx="356" cy="96" r="34" fill="${p.accent}" opacity=".28"/>
    <path d="M0 300l92-118 54 62 44-44 88 100z" fill="${p.accent}" opacity=".18"/>
    <path d="M0 320l120-92 74 70 56-42 90 64z" fill="${p.accent}" opacity=".3"/>
    <path d="M0 330h480" stroke="${p.ink}" stroke-width="1.4" opacity=".25"/>
    <path d="M58 282c60-40 108-26 150 6s86 30 132-8" fill="none" stroke="${p.ink}" stroke-width="1.4" stroke-dasharray="5 7" opacity=".55"/>
    <circle cx="58" cy="282" r="6" fill="${p.ink}" opacity=".7"/>
    <path d="M330 210c0-12 10-20 20-20s20 8 20 20c0 14-20 34-20 34s-20-20-20-34z" fill="${p.accent}" opacity=".85"/>
    <circle cx="350" cy="208" r="4" fill="#fffdf8"/>
    <g stroke="${p.ink}" stroke-width="1.3" opacity=".3"><path d="M30 70h84"/><path d="M30 88h52"/></g>`,

  food: (p) => `
    <path d="M130 190h220c-4 62-48 100-110 100s-106-38-110-100z" fill="#fffdf8" stroke="${p.ink}" stroke-width="2"/>
    <path d="M150 206h180" stroke="${p.accent}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
    <path d="M190 246c10-12 26-12 36 0s26 12 36 0 26-12 36 0" fill="none" stroke="${p.accent}" stroke-width="2.4" stroke-linecap="round"/>
    <g fill="none" stroke="${p.ink}" stroke-width="2" stroke-linecap="round" opacity=".38">
      <path d="M198 170c-12-22 10-30 0-52"/><path d="M240 162c-12-22 10-30 0-52"/><path d="M282 170c-12-22 10-30 0-52"/>
    </g>
    <g stroke="${p.ink}" stroke-width="2.2" stroke-linecap="round" opacity=".55">
      <path d="M330 96l52 146"/><path d="M342 92l52 146"/>
    </g>
    <g fill="${p.accent}" opacity=".5">
      <circle cx="96" cy="120" r="3"/><circle cx="76" cy="144" r="2"/><circle cx="404" cy="130" r="2.6"/><circle cx="420" cy="160" r="1.8"/>
    </g>`,

  tech: (p) => `
    <g stroke="${p.accent}" stroke-width="1" opacity=".22">
      <path d="M0 90h480"/><path d="M0 150h480"/><path d="M0 210h480"/><path d="M0 270h480"/>
      <path d="M90 0v360"/><path d="M180 0v360"/><path d="M270 0v360"/><path d="M360 0v360"/>
    </g>
    <rect x="118" y="84" width="244" height="172" rx="16" fill="${p.ink}" opacity=".92"/>
    <rect x="134" y="100" width="212" height="140" rx="9" fill="#0e1b2b"/>
    <g stroke="${p.accent}" stroke-width="2" stroke-linecap="round" opacity=".85">
      <path d="M152 128h62"/><path d="M152 146h94"/><path d="M152 164h48"/><path d="M152 182h110"/><path d="M152 200h70"/>
    </g>
    <circle cx="330" cy="196" r="4" fill="${p.accent}"/>
    <g stroke="${p.accent}" stroke-width="1.4" opacity=".45" fill="none">
      <path d="M362 130h54v52"/><path d="M62 220h56v-48"/>
    </g>
    <circle cx="416" cy="182" r="4" fill="${p.accent}" opacity=".7"/>
    <circle cx="62" cy="172" r="4" fill="${p.accent}" opacity=".7"/>`,

  nature: (p) => `
    <circle cx="372" cy="92" r="42" fill="${p.accent}" opacity=".22"/>
    <path d="M0 236c66-38 110-30 156-6s96 34 152 2 108-34 172-6v134H0z" fill="${p.accent}" opacity=".22"/>
    <path d="M0 282c72-28 122-10 174 10s112 16 168-10 90-18 138 0v78H0z" fill="${p.accent}" opacity=".34"/>
    <g stroke="${p.ink}" stroke-width="1.6" stroke-linecap="round" opacity=".5">
      <path d="M96 300v-62"/><path d="M110 300v-44"/><path d="M124 300v-72"/><path d="M138 300v-38"/>
    </g>
    <path d="M206 96c8-8 18-8 26 0M236 84c8-8 18-8 26 0" fill="none" stroke="${p.ink}" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>
    <g stroke="${p.accent}" stroke-width="1.2" opacity=".3">
      <path d="M20 320h150"/><path d="M60 334h120"/><path d="M300 326h150"/><path d="M330 340h96"/>
    </g>
    <g fill="${p.ink}" opacity=".4">
      <circle cx="440" cy="250" r="2.4"/><circle cx="60" cy="70" r="2"/><circle cx="300" cy="50" r="1.8"/>
    </g>`,
};

let counter = 0;

export function sceneArt(sceneId, { caption = false, seed = '' } = {}) {
  const scene = getScene(sceneId);
  const id = `art-${scene.id}-${(counter += 1)}-${String(seed).replace(/[^a-z0-9]/gi, '').slice(0, 6)}`;
  const builder = BUILDERS[scene.id] || BUILDERS.music;
  const p = { accent: scene.accent, soft: scene.soft, ink: scene.ink };
  const random = mulberry32(hashString(String(seed) || scene.id));
  const dx = (random() - 0.5) * 16;
  const dy = (random() - 0.5) * 12;
  const rotate = (random() - 0.5) * 3;
  return `<svg viewBox="0 0 480 360" role="img" aria-label="${scene.name}场景插画">
    <defs>
      <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${p.soft}"/><stop offset="1" stop-color="#fffdf7"/>
      </linearGradient>
      <radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="${p.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="480" height="360" fill="url(#${id}-bg)"/>
    <circle cx="240" cy="170" r="190" fill="url(#${id}-glow)"/>
    <g transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)}) rotate(${rotate.toFixed(2)} 240 180)">
      <g class="art-anim">${builder(p)}</g>
    </g>
    ${caption ? `<g><rect x="24" y="306" width="196" height="30" rx="15" fill="#fffdf8" opacity=".86"/><text x="40" y="326" font-family="Segoe UI, sans-serif" font-size="12" fill="${p.ink}" opacity=".72">${scene.en} · ${scene.name}</text></g>` : ''}
  </svg>`;
}

export function heroArt() {
  return sceneArt('music', { seed: 'hero' });
}
