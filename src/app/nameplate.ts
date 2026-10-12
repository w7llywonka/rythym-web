// Player names with their tag badge and name color: the home chip, the profile, leaderboards, the live
// feed and 1v1. Tags and colors are looked up by id in shared/cosmetics.js, so only the catalog's own
// labels and colors are ever drawn; an unknown id shows a plain name. Names are always text, never markup.
// (No app imports here, so the tests can load it.)
import { NAME_COLORS, TAGS } from '../../shared/cosmetics.js';

/** what a name is drawn with: ids from the catalog ('' / missing = none / white) */
export interface LookIds { tag?: string; color?: string }

export interface Plate {
  name: string;
  tag: { id: string; label: string; color: string; desc: string } | null;
  /** solid name color, or a gradient (drawn with background-clip: text); both null = the default white */
  color: string | null;
  gradient: string | null;
}

export function plateOf(name: string, look?: LookIds | null): Plate {
  const tagId = typeof look?.tag === 'string' ? look.tag : '';
  const colorId = typeof look?.color === 'string' ? look.color : '';
  const tag = tagId ? TAGS.find(t => t.id === tagId) : undefined;
  const c = colorId && colorId !== 'default' ? NAME_COLORS.find(x => x.id === colorId) : undefined;
  return {
    name,
    tag: tag ? { id: tag.id, label: tag.label, color: tag.color, desc: tag.desc } : null,
    color: c && !c.gradient ? c.color : null,
    gradient: c?.gradient ?? null,
  };
}

// same as shell.ts escapeHtml (kept here so this module has no app imports)
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** for labels built from HTML strings (the live feed, the challenge pop-up): the name is escaped */
export function nameplateHtml(name: string, look?: LookIds | null): string {
  const p = plateOf(name, look);
  const tag = p.tag ? `<span class="np-tag" style="--tc:${p.tag.color}" title="${esc(p.tag.desc)}">${esc(p.tag.label)}</span>` : '';
  const style = p.gradient ? ` class="np-name np-grad" style="background-image:${p.gradient}"`
    : p.color ? ` class="np-name" style="color:${p.color}"` : ' class="np-name"';
  return `<span class="np">${tag}<b${style}>${esc(p.name)}</b></span>`;
}

function span(cls: string, text: string) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

/** the nameplate as elements; `extra` is a muted note after the name (a title) */
export function nameplateEl(name: string, look?: LookIds | null, extra = ''): HTMLElement {
  const p = plateOf(name, look);
  const root = span('np', '');
  if (p.tag) {
    const t = span('np-tag', p.tag.label);
    t.style.setProperty('--tc', p.tag.color);
    t.title = p.tag.desc;
    root.append(t);
  }
  const n = span('np-name', p.name);
  if (p.gradient) {
    n.classList.add('np-grad');
    n.style.backgroundImage = p.gradient;
  } else if (p.color) n.style.color = p.color;
  root.append(n);
  if (extra) root.append(span('np-extra', extra));
  return root;
}

/** draws a nameplate into a label made by node() (into its text span, so alignment and truncation still apply) */
export function renderNameplate(el: HTMLElement, name: string, look?: LookIds | null, extra = '') {
  const host = (el.querySelector(':scope > .tx') as HTMLElement | null) ?? el;
  host.replaceChildren(nameplateEl(name, look, extra));
}
