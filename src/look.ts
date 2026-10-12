// How the falling lines look and what a hit looks like. Shared by the game, the Customize / Settings
// previews and the Locker so they all match.
import { HIT_EFFECTS, NOTE_SKINS, THEMES } from '../shared/cosmetics.js';
import { ease, tween } from './anim.ts';
import { SWATCHES } from './config.ts';
import type { HitEffect, NoteStyle } from './types.ts';
import { rgba } from './ui.ts';

export { SWATCHES };

/** every line style: the free four, then the ones you unlock (see the Locker) */
export const NOTE_STYLES = NOTE_SKINS.map(s => s.id) as NoteStyle[];
export const HIT_EFFECT_IDS = HIT_EFFECTS.map(e => e.id) as HitEffect[];
export const THEME_IDS = THEMES.map(t => t.id);
export const NOTE_SIZE = { min: 12, max: 32, step: 2 };

export function lighten(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** mixes #RRGGBB toward another #RRGGBB (k = 0..1) */
export function mix(hex: string, to: string, k: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0').toUpperCase()}`;
}
/** darker: k = 0 (the same) .. 1 (black) */
export const shade = (hex: string, k: number) => mix(hex, '#000000', k);
/** a color at an opacity (ui.ts rgba() takes the transparency instead) */
const alpha = (hex: string, a: number) => rgba(hex, 1 - a);

const PRISM = ['#FF5CA8', '#FF8A3D', '#F5C451', '#4ADE80', '#2BD4FF', '#A78BFA'];
/** two rainbows in a row, so sliding the background by half its size loops without a seam */
const prism = (dir: string, a = 1) => `linear-gradient(${dir}, ${[...PRISM, ...PRISM, PRISM[0]].map(c => alpha(c, a)).join(', ')})`;

/** the playfield and lane colors for a lane dim setting (0 = default .. 0.9 = almost black) */
export function laneLook(dim: number) {
  const lane = shade('#15151B', dim);
  return {
    field: shade('#0E0E12', dim),
    lane: `linear-gradient(180deg, ${alpha(lane, 0)} 0%, ${alpha(lane, 0.7)} 35%, ${lane} 100%)`,
  };
}

/** Styles a note: `el` is the positioned wrapper (centered on the note's time), `bar` the visible line. */
export function styleNote(el: HTMLElement, bar: HTMLElement, color: string, style: NoteStyle, size: number, effects: boolean) {
  const pad = style === 'Classic' ? 7 : 8;
  const h = size + pad * 2;
  el.style.height = `${h}px`;
  el.style.borderRadius = `${h / 2}px`;
  el.style.background = 'transparent';
  bar.style.top = `${pad}px`;
  bar.style.height = `${size}px`;
  bar.style.borderRadius = `${size / 2}px`;
  // only some skins use these: clear them so a restyled element doesn't keep the last skin's
  bar.style.backgroundSize = '';
  bar.style.clipPath = '';
  // CSS animates the Prism and Ember skins
  bar.dataset.skin = style;
  const glow = (a: number, blur = 16) => (effects ? `, 0 0 ${blur}px ${alpha(color, a)}` : '');
  switch (style) {
    default: // anything unknown draws like Glow
    case 'Glow':
      bar.style.background = `linear-gradient(180deg, ${lighten(color, 0.35)}, ${color})`;
      bar.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,.45)${glow(0.45)}`;
      break;
    case 'Flat':
      bar.style.background = color;
      bar.style.boxShadow = 'none';
      break;
    case 'Outline':
      bar.style.background = alpha(color, 0.14);
      bar.style.boxShadow = `inset 0 0 0 2px ${color}${glow(0.35, 10)}`;
      break;
    case 'Classic':
      el.style.background = effects ? alpha(color, 0.2) : 'transparent';
      bar.style.background = `linear-gradient(180deg, ${lighten(color, 0.45)}, ${color})`;
      bar.style.boxShadow = '0 0 0 1.5px rgba(255,255,255,.45)';
      break;
    case 'Neon': // a colored glass tube with a white-hot core
      bar.style.background = `linear-gradient(180deg, ${alpha(color, 0.3)} 0%, ${lighten(color, 0.55)} 34%, #FFFFFF 50%, ${lighten(color, 0.55)} 66%, ${alpha(color, 0.3)} 100%)`;
      bar.style.boxShadow = `inset 0 0 0 2px ${color}${effects ? `, 0 0 4px ${color}, 0 0 20px ${alpha(color, 0.75)}` : ''}`;
      break;
    case 'Pixel': { // square blocks with a light top row, a dark bottom row and stepped corners
      const px = Math.max(2, Math.round(size / 6));
      const seam = Math.max(2, Math.round(px / 2));
      el.style.borderRadius = '0';
      bar.style.borderRadius = '0';
      bar.style.background = [
        `linear-gradient(#FFFFFF, #FFFFFF) ${px * 2}px ${px}px / ${px * 2}px ${px}px no-repeat`,
        `repeating-linear-gradient(90deg, transparent 0 ${size - seam}px, rgba(0,0,0,.3) ${size - seam}px ${size}px)`,
        `linear-gradient(180deg, ${lighten(color, 0.5)} 0 ${px}px, ${color} ${px}px calc(100% - ${px}px), ${shade(color, 0.4)} calc(100% - ${px}px) 100%)`,
      ].join(', ');
      bar.style.boxShadow = 'none';
      const c = (x: string, y: string) => `${x} ${y}`;
      const p = `${px}px`, q = `calc(100% - ${px}px)`;
      bar.style.clipPath = `polygon(${[c(p, '0'), c(q, '0'), c(q, p), c('100%', p), c('100%', q), c(q, q), c(q, '100%'), c(p, '100%'), c(p, q), c('0', q), c('0', p), c(p, p)].join(', ')})`;
      break;
    }
    case 'Chrome': // polished metal: bright sky, dark horizon, the lane color reflected underneath
      bar.style.background = `linear-gradient(180deg, #FFFFFF 0%, ${lighten(color, 0.75)} 24%, ${shade(color, 0.45)} 48%, ${color} 56%, ${lighten(color, 0.45)} 84%, #FFFFFF 100%)`;
      bar.style.boxShadow = `inset 0 0 0 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.6)${glow(0.3, 14)}`;
      break;
    case 'Ghost': // see-through, a bright edge, and a faint wisp trailing above
      bar.style.background = `linear-gradient(180deg, ${alpha(color, 0.03)}, ${alpha(color, 0.2)})`;
      bar.style.boxShadow = `inset 0 0 0 1.5px ${lighten(color, 0.35)}, inset 0 0 10px ${alpha(color, 0.45)}${effects ? `, 0 -10px 18px -8px ${alpha(color, 0.6)}` : ''}`;
      break;
    case 'Ember': // glowing hot from the inside
      bar.style.background = `radial-gradient(ellipse 62% 130% at 50% 70%, #FFF4D6 0%, ${lighten(color, 0.45)} 30%, ${color} 62%, ${shade(color, 0.55)} 100%)`;
      bar.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,.3), inset 0 -2px 5px rgba(255,138,61,.55)${effects ? `, 0 0 18px ${alpha(color, 0.55)}, 0 3px 12px rgba(255,138,61,.4)` : ''}`;
      break;
    case 'Prism': // a rainbow that slides along (style.css), framed in the lane color so lanes stay readable
      bar.style.background = prism('90deg');
      bar.style.backgroundSize = '200% 100%';
      bar.style.boxShadow = `inset 0 0 0 2px ${color}, inset 0 3px 4px rgba(255,255,255,.4)${glow(0.5)}`;
      break;
  }
}

/** Hold trail behind a note's head. */
export function styleHold(body: HTMLElement, cap: HTMLElement, color: string, style: NoteStyle) {
  body.style.borderRadius = '';
  body.style.backgroundSize = '';
  body.style.boxShadow = 'none';
  body.dataset.skin = style;
  cap.style.borderRadius = '';
  cap.style.boxShadow = 'none';
  cap.style.background = color;
  switch (style) {
    default:
      body.style.background = `linear-gradient(180deg, ${alpha(color, 0.35)}, ${alpha(color, 0.7)})`;
      break;
    case 'Outline':
      body.style.background = alpha(color, 0.1);
      body.style.boxShadow = `inset 0 0 0 2px ${alpha(color, 0.6)}`;
      break;
    case 'Neon': // a thin white-hot core down a colored tube
      body.style.background = `linear-gradient(90deg, ${alpha(color, 0.12)}, ${alpha(color, 0.4)} 36%, ${lighten(color, 0.55)} 47%, #FFFFFF 50%, ${lighten(color, 0.55)} 53%, ${alpha(color, 0.4)} 64%, ${alpha(color, 0.12)})`;
      body.style.boxShadow = `inset 0 0 0 1.5px ${alpha(color, 0.6)}, 0 0 10px ${alpha(color, 0.35)}`;
      cap.style.background = lighten(color, 0.6);
      cap.style.boxShadow = `0 0 8px ${color}`;
      break;
    case 'Pixel':
      body.style.borderRadius = '0';
      body.style.background = `repeating-linear-gradient(180deg, ${alpha(color, 0.75)} 0 10px, ${alpha(shade(color, 0.35), 0.75)} 10px 14px)`;
      cap.style.borderRadius = '0';
      break;
    case 'Chrome':
      body.style.background = `linear-gradient(90deg, ${shade(color, 0.45)}, ${lighten(color, 0.8)} 30%, ${color} 58%, ${shade(color, 0.35)})`;
      cap.style.background = `linear-gradient(180deg, #FFFFFF, ${color})`;
      break;
    case 'Ghost':
      body.style.background = alpha(color, 0.08);
      body.style.boxShadow = `inset 0 0 0 1.5px ${alpha(color, 0.55)}`;
      cap.style.background = alpha(color, 0.75);
      break;
    case 'Ember':
      body.style.background = `linear-gradient(180deg, ${alpha(color, 0.15)}, ${alpha(color, 0.6)} 65%, ${lighten(color, 0.4)})`;
      body.style.boxShadow = `0 0 14px ${alpha(color, 0.4)}`;
      cap.style.background = lighten(color, 0.5);
      break;
    case 'Prism':
      body.style.background = prism('180deg', 0.6);
      body.style.backgroundSize = '100% 200%';
      body.style.boxShadow = `inset 0 0 0 2px ${alpha(color, 0.8)}`;
      break;
  }
}

// ---- hit effects (shared/cosmetics.js HIT_EFFECTS) ------------------------------------------------

/** where a hit happened, in the effect layer's pixels: the button's centre and its lane */
export interface HitSpot { x: number; y: number; laneX: number; laneW: number; top: number }

function fxEl(layer: HTMLElement, cls: string, x: number, y: number) {
  const d = document.createElement('div');
  d.className = `hfx ${cls}`;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  layer.appendChild(d);
  return d;
}

/** runs `apply` from 0 to 1 (from the first frame, so the end state never flashes up), then removes `el` */
function animate(el: HTMLElement, seconds: number, apply: (k: number) => void, easing = ease.quad, delay = 0) {
  apply(0);
  tween(el, 'fx', 0, 1, seconds, apply, easing, delay, () => el.remove());
}

/** today's ring: grows and fades */
function ring(layer: HTMLElement, color: string, x: number, y: number, scale: number) {
  const r = fxEl(layer, 'hfx-ring', x, y);
  animate(r, 0.35, k => {
    const size = (90 + 100 * k) * scale;
    r.style.width = r.style.height = `${size}px`;
    r.style.boxShadow = `0 0 0 ${(6 - 5 * k) * Math.max(0.5, scale)}px ${rgba(color, k)}`;
  });
}

function flash(layer: HTMLElement, color: string, x: number, y: number, size: number, seconds: number) {
  const d = fxEl(layer, 'hfx-burst', x, y);
  d.style.width = d.style.height = `${size}px`;
  d.style.background = `radial-gradient(circle, #FFFFFF 0%, ${alpha(color, 0.85)} 18%, ${alpha(color, 0.3)} 44%, ${alpha(color, 0)} 70%)`;
  animate(d, seconds, k => {
    d.style.transform = `translate(-50%, -50%) scale(${0.35 + 0.95 * k})`;
    d.style.opacity = String(1 - k * k);
  }, ease.quart);
}

/**
 * Plays a hit effect in `layer`. `color` is the judgment's, `perfect` whether it was a Perfect
 * (Stars only shows on those). `scale` shrinks it for the small previews in the menus.
 */
export function playHitEffect(layer: HTMLElement, kind: HitEffect, color: string, at: HitSpot, perfect: boolean, scale = 1) {
  // a very busy stretch: keep the screen readable (and the frame rate up)
  if (layer.childElementCount > 120) return;
  const { x, y } = at;
  switch (kind) {
    case 'None':
      return;
    case 'Burst':
      flash(layer, color, x, y, 140 * scale, 0.28);
      return;
    case 'Sparks':
      flash(layer, color, x, y, 60 * scale, 0.18);
      for (let i = 0; i < 12; i++) {
        // a fan of sparks, mostly upward, falling back a little as they go
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
        const dist = (60 + Math.random() * 55) * scale;
        const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist, drop = 30 * scale;
        const s = fxEl(layer, 'hfx-spark', x, y);
        s.style.width = `${Math.max(2, 3.5 * scale)}px`;
        s.style.height = `${Math.max(6, 16 * scale)}px`;
        s.style.background = i % 3 === 0 ? '#FFFFFF' : lighten(color, 0.25);
        s.style.boxShadow = `0 0 ${8 * scale}px ${color}, 0 0 2px #FFFFFF`;
        const rot = (ang * 180) / Math.PI + 90;
        animate(s, 0.42 + Math.random() * 0.18, k => {
          s.style.transform = `translate(-50%, -50%) translate(${dx * k}px, ${dy * k + drop * k * k}px) rotate(${rot}deg) scaleY(${1 - 0.55 * k})`;
          s.style.opacity = String(1 - k * k);
        }, ease.quart);
      }
      return;
    case 'Stars':
      if (!perfect) return ring(layer, color, x, y, scale * 0.7);
      flash(layer, color, x, y, 70 * scale, 0.22);
      for (let i = 0; i < 5; i++) {
        // a glowing holder (filters can't glow through a clip-path) around the star shape
        const st = fxEl(layer, 'hfx-glint', x + (i - 2) * 12 * scale, y - 4 * scale);
        const size = (16 + Math.random() * 9) * scale;
        st.style.width = st.style.height = `${size}px`;
        st.style.filter = `drop-shadow(0 0 ${5 * scale}px ${color})`;
        const shape = document.createElement('div');
        shape.className = 'hfx-star';
        shape.style.background = `radial-gradient(circle, #FFFFFF 0%, #FFFFFF 30%, ${i % 2 ? lighten(color, 0.4) : color} 70%)`;
        st.appendChild(shape);
        const dx = (i - 2) * 22 * scale + (Math.random() - 0.5) * 18 * scale;
        const rise = (65 + Math.random() * 50) * scale;
        const spin = (i % 2 ? -1 : 1) * (90 + Math.random() * 120);
        animate(st, 0.75, k => {
          const grow = k < 0.18 ? 0.4 + 4 * k : 1.12 - 0.5 * (k - 0.18);
          st.style.transform = `translate(-50%, -50%) translate(${dx * k}px, ${-rise * k}px) rotate(${spin * k}deg) scale(${grow})`;
          st.style.opacity = String(1 - k * k * k);
        }, ease.quart, i * 0.025);
      }
      return;
    case 'Shockwave': {
      // a band of light that runs up the whole lane, and a quick glow over the lane
      const lane = fxEl(layer, 'hfx-lane', at.laneX, at.top);
      lane.style.width = `${at.laneW}px`;
      lane.style.height = `${y - at.top + 16 * scale}px`;
      lane.style.background = `linear-gradient(0deg, ${alpha(color, 0.26)}, ${alpha(color, 0)} 70%)`;
      animate(lane, 0.32, k => { lane.style.opacity = String(1 - k); });
      const w = fxEl(layer, 'hfx-wave', at.laneX + at.laneW / 2, y);
      w.style.width = `${at.laneW - 10 * scale}px`;
      w.style.height = `${Math.max(4, 10 * scale)}px`;
      w.style.background = `linear-gradient(180deg, ${alpha(color, 0)}, ${alpha(color, 0.9)} 40%, #FFFFFF 50%, ${alpha(color, 0.9)} 60%, ${alpha(color, 0)})`;
      w.style.boxShadow = `0 0 16px ${alpha(color, 0.6)}`;
      const travel = (y - at.top) * 0.85;
      animate(w, 0.45, k => {
        w.style.transform = `translate(-50%, -50%) translateY(${-travel * k}px) scaleY(${1 + 2.4 * k})`;
        w.style.opacity = String(1 - k);
      });
      return;
    }
    default:
      ring(layer, color, x, y, scale);
  }
}
