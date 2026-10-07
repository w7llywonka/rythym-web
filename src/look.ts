// How the falling lines look. Shared by the game and the Customize preview so both match.
import { SWATCHES } from './config.ts';
import type { NoteStyle } from './types.ts';
import { rgba } from './ui.ts';

export { SWATCHES };

export const NOTE_STYLES: NoteStyle[] = ['Glow', 'Flat', 'Outline', 'Classic'];
export const NOTE_SIZE = { min: 12, max: 32, step: 2 };

export function lighten(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
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
  switch (style) {
    case 'Glow':
      bar.style.background = `linear-gradient(180deg, ${lighten(color, 0.35)}, ${color})`;
      bar.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,.45)${effects ? `, 0 0 16px ${rgba(color, 0.55)}` : ''}`;
      break;
    case 'Flat':
      bar.style.background = color;
      bar.style.boxShadow = 'none';
      break;
    case 'Outline':
      bar.style.background = rgba(color, 0.86);
      bar.style.boxShadow = `inset 0 0 0 2px ${color}${effects ? `, 0 0 10px ${rgba(color, 0.65)}` : ''}`;
      break;
    case 'Classic':
      el.style.background = effects ? rgba(color, 0.8) : 'transparent';
      bar.style.background = `linear-gradient(180deg, ${lighten(color, 0.45)}, ${color})`;
      bar.style.boxShadow = '0 0 0 1.5px rgba(255,255,255,.45)';
      break;
  }
}

/** Hold trail behind a note's head. */
export function styleHold(body: HTMLElement, cap: HTMLElement, color: string, style: NoteStyle) {
  const outline = style === 'Outline';
  body.style.background = outline
    ? rgba(color, 0.9)
    : `linear-gradient(180deg, ${rgba(color, 0.65)}, ${rgba(color, 0.3)})`;
  body.style.boxShadow = outline ? `inset 0 0 0 2px ${rgba(color, 0.4)}` : 'none';
  cap.style.background = color;
}
