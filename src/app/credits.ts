// Credits: every licensed song with its artist, license and source (CC BY requires credit).
import type { Credit } from '../types.ts';
import { $ } from '../ui.ts';
import { closeModal, onClick, openModal } from './shell.ts';
import { S } from './state.ts';

function link(text: string, href: string) {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function render() {
  const rows = S.tracks
    .filter((t): t is typeof t & { song: { credit: Credit } } => !!t.song.credit)
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
    .map(t => {
      const c = t.song.credit;
      const row = document.createElement('div');
      row.className = 'credit';
      const title = document.createElement('b');
      title.textContent = t.title;
      const by = document.createElement('span');
      by.textContent = ` by ${t.artist}`;
      const meta = document.createElement('div');
      meta.append(link(c.license, c.licenseUrl), document.createTextNode('  ·  '), link(c.source, c.sourceUrl));
      row.append(title, by, meta);
      return row;
    });
  const original = document.createElement('div');
  original.className = 'credit';
  original.innerHTML = '<b>Line Rush originals</b><span> (the ten Easy / Hard songs)</span><div>Made for this game, CC0</div>';
  $('credits.list').replaceChildren(...rows, original);
}

export function initCredits() {
  onClick('home.credits', () => { render(); openModal($('credits')); });
  onClick('credits.close', closeModal);
}
