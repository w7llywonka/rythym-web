// Nameplates (tags + name colors next to player names) and what the Locker shows (states, NEW, progress, counts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { HIT_EFFECTS, NAME_COLORS, NOTE_SKINS, TAGS, THEMES, type UnlockStats } from '../shared/cosmetics.js';
import { ACHIEVEMENTS } from '../src/config.ts';
import {
  LOCKER_TABS, cardState, isNew, keysToMarkSeen, lockerCounts, ruleProgress, startTab, unlockParts, unlockSummary,
} from '../src/app/lockerView.ts';
import { nameplateEl, nameplateHtml, plateOf, renderNameplate } from '../src/app/nameplate.ts';
import type { Unlockable } from '../src/app/unlocks.ts';

// the same list unlocks.ts builds (it can't be loaded here: it needs the app)
const ITEMS: Unlockable[] = [
  ...ACHIEVEMENTS.map(a => ({ key: `title:${a.id}`, category: 'title' as const, id: a.title, label: a.title, desc: a.desc, unlock: { kind: 'achievement' as const, id: a.id, name: a.name } })),
  ...TAGS.map(t => ({ key: `tag:${t.id}`, category: 'tag' as const, id: t.id, label: t.label, desc: t.desc, unlock: t.unlock, color: t.color })),
  ...NAME_COLORS.map(c => ({ key: `color:${c.id}`, category: 'color' as const, id: c.id, label: c.label, desc: '', unlock: c.unlock, color: c.color, gradient: c.gradient })),
  ...NOTE_SKINS.map(s => ({ key: `skin:${s.id}`, category: 'skin' as const, id: s.id, label: s.label, desc: s.desc, unlock: s.unlock })),
  ...HIT_EFFECTS.map(e => ({ key: `effect:${e.id}`, category: 'effect' as const, id: e.id, label: e.label, desc: e.desc, unlock: e.unlock })),
  ...THEMES.map(t => ({ key: `theme:${t.id}`, category: 'theme' as const, id: t.id, label: t.label, desc: '', unlock: t.unlock, colors: t.colors })),
];
const item = (key: string) => ITEMS.find(u => u.key === key)!;
const fresh: UnlockStats = { level: 1, plays: 0, streak: 0, fcs: 0, ss: 0, vsWins: 0, imports: 0, kings: 0, tops: 0, tutorialDone: false, since: 0, achievements: {} };

// ---- nameplates ------------------------------------------------------------------------------------
test('nameplate: tags and colors come from the catalog by id; anything unknown is a plain name', () => {
  assert.deepEqual(plateOf('will'), { name: 'will', tag: null, color: null, gradient: null });
  assert.deepEqual(plateOf('will', { tag: '<script>', color: 'javascript:alert(1)' }), { name: 'will', tag: null, color: null, gradient: null });
  assert.deepEqual(plateOf('will', { tag: '__proto__', color: 'constructor' }).tag, null);
  assert.equal(plateOf('will', { color: 'default' }).color, null, 'white is the default: no color set');
  const p = plateOf('will', { tag: 'veteran', color: 'gold' });
  assert.equal(p.tag?.label, 'VETERAN');
  assert.equal(p.tag?.color, TAGS.find(t => t.id === 'veteran')!.color);
  assert.equal(p.color, '#F5C451');
  const g = plateOf('will', { color: 'aurora' });
  assert.equal(g.color, null);
  assert.match(g.gradient ?? '', /^linear-gradient\(/);
  // non-string ids (a bad server answer) are ignored
  assert.equal(plateOf('x', { tag: 5 as unknown as string, color: {} as unknown as string }).tag, null);
});

test('nameplate HTML: the name is escaped, only catalog text and colors go in', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const out = nameplateHtml(evil, { tag: 'champion', color: 'rose' });
  assert.ok(!out.includes('<img'), out);
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'), out);
  assert.ok(out.includes('>CHAMPION</span>'));
  assert.ok(out.includes('color:#FF5CA8'));
  const plain = nameplateHtml('lowkey', { tag: 'nope"><script>', color: 'x" onmouseover="y' });
  assert.equal(plain, '<span class="np"><b class="np-name">lowkey</b></span>');
  assert.ok(nameplateHtml('mira', { color: 'sunset' }).includes('class="np-name np-grad" style="background-image:linear-gradient('));
});

// a tiny stand-in for the DOM: enough for nameplateEl / renderNameplate
class FakeEl {
  className = ''; textContent = ''; title = ''; children: (FakeEl | string)[] = [];
  props: Record<string, string> = {};
  style = { color: '', backgroundImage: '', setProperty: (k: string, v: string) => { this.props[k] = v; } };
  classList = { add: (c: string) => { this.className += ` ${c}`; } };
  tx: FakeEl | null;
  constructor(tx: FakeEl | null = null) { this.tx = tx; }
  append(...c: (FakeEl | string)[]) { this.children.push(...c); }
  replaceChildren(...c: (FakeEl | string)[]) { this.children = c; }
  querySelector(sel: string) { return sel === ':scope > .tx' ? this.tx : null; }
}
(globalThis as { document?: unknown }).document = { createElement: () => new FakeEl() };

test('nameplate elements: text only, tag badge first, then the name, then the extra', () => {
  const el = nameplateEl('<b>nova</b>', { tag: 'king', color: 'royal' }, '·  Godlike') as unknown as FakeEl;
  assert.equal(el.className, 'np');
  const [tag, name, extra] = el.children as FakeEl[];
  assert.equal(tag.className, 'np-tag');
  assert.equal(tag.textContent, 'KING');
  assert.equal(tag.props['--tc'], '#F5C451');
  assert.equal(name.textContent, '<b>nova</b>', 'set as text, never parsed');
  assert.ok(name.className.includes('np-grad'));
  assert.match(name.style.backgroundImage, /linear-gradient/);
  assert.equal(extra.textContent, '·  Godlike');
  const bare = nameplateEl('lowkey', { tag: 'bogus' }) as unknown as FakeEl;
  assert.equal(bare.children.length, 1);
  assert.equal((bare.children[0] as FakeEl).style.color, '');
});

test('renderNameplate draws into a label\'s text span (or the element itself)', () => {
  const tx = new FakeEl();
  const label = new FakeEl(tx);
  renderNameplate(label as unknown as HTMLElement, 'will', { color: 'sky' });
  assert.equal(tx.children.length, 1);
  assert.equal(label.children.length, 0);
  const lone = new FakeEl();
  renderNameplate(lone as unknown as HTMLElement, 'will');
  assert.equal(((lone.children[0] as FakeEl).children[0] as FakeEl).textContent, 'will');
});

// ---- the Locker ------------------------------------------------------------------------------------
test('locker: a tab for every kind of unlockable, and every unlockable has a tab', () => {
  assert.deepEqual(LOCKER_TABS.map(t => t.cat), ['title', 'tag', 'color', 'skin', 'effect', 'theme']);
  for (const u of ITEMS) assert.ok(LOCKER_TABS.some(t => t.cat === u.category), u.key);
  for (const t of LOCKER_TABS) assert.match(t.accent, /^#[0-9A-F]{6}$/);
});

test('locker: equipped / unlocked / locked', () => {
  assert.equal(cardState(true, true), 'equipped');
  assert.equal(cardState(true, false), 'unlocked');
  assert.equal(cardState(false, false), 'locked');
  assert.equal(cardState(false, true), 'locked', 'a stale choice for something locked never shows as equipped');
});

test('locker: NEW is unlocked, not free, and not seen yet', () => {
  assert.equal(isNew(item('skin:Glow'), true, {}), false, 'free things are never new');
  assert.equal(isNew(item('tag:veteran'), false, {}), false, 'locked is not new');
  assert.equal(isNew(item('tag:veteran'), true, {}), true);
  assert.equal(isNew(item('tag:veteran'), true, { 'tag:veteran': true }), false);
});

test('locker: progress toward counted rules', () => {
  assert.deepEqual(ruleProgress(item('tag:veteran').unlock, { ...fresh, level: 7 }), { have: 7, need: 10 });
  assert.deepEqual(ruleProgress(item('tag:grinder').unlock, { ...fresh, plays: 9999 }), { have: 500, need: 500 }, 'capped at the goal');
  assert.deepEqual(ruleProgress(item('tag:devoted').unlock, { ...fresh, streak: 12 }), { have: 12, need: 30 });
  assert.equal(ruleProgress(item('tag:combo').unlock, fresh), null, 'achievements are yes / no');
  assert.equal(ruleProgress(item('tag:graduate').unlock, fresh), null);
  assert.equal(ruleProgress(item('tag:duelist').unlock, fresh), null, '"win a 1v1" needs no 0 / 1 bar');
  assert.equal(ruleProgress(item('skin:Glow').unlock, fresh), null);
});

test('locker: counts overall and per tab, NEW only for unseen unlocks', () => {
  const start = lockerCounts(ITEMS, fresh, {});
  assert.equal(start.all.total, ITEMS.length);
  assert.equal(start.byCat.tag.total, TAGS.length);
  assert.equal(start.byCat.title.total, ACHIEVEMENTS.length);
  assert.equal(start.all.fresh, 0, 'a brand new player has only free things, none of them new');
  const free = ITEMS.filter(u => u.unlock.kind === 'always').length;
  assert.equal(start.all.unlocked, free);

  const vet: UnlockStats = { ...fresh, level: 12, plays: 60, tutorialDone: true, achievements: { first_clear: true } };
  const seen = { 'tag:veteran': true as const };
  const c = lockerCounts(ITEMS, vet, seen);
  // tags: graduate, rookie, regular, veteran unlocked; veteran already seen
  assert.equal(c.byCat.tag.unlocked, 4);
  assert.equal(c.byCat.tag.fresh, 3);
  assert.equal(c.byCat.title.unlocked, 1);
  assert.equal(c.byCat.title.fresh, 1);
  assert.equal(c.all.fresh, Object.values(c.byCat).reduce((n, x) => n + x.fresh, 0));
  assert.ok(c.byCat.color.unlocked >= 3, 'mint, sky, rose by level 12');

  const marks = keysToMarkSeen(ITEMS, 'tag', vet, seen);
  assert.deepEqual(marks.sort(), ['tag:graduate', 'tag:regular', 'tag:rookie']);
  assert.ok(marks.every(k => k.startsWith('tag:')));
  // marking them seen clears the tab
  const after = lockerCounts(ITEMS, vet, { ...seen, ...Object.fromEntries(marks.map(k => [k, true as const])) });
  assert.equal(after.byCat.tag.fresh, 0);
  assert.equal(after.byCat.tag.unlocked, 4, 'seen or not, still unlocked');
  // every key the Locker marks is one the save keeps (storage.ts: /^[a-z]{1,12}:[A-Za-z0-9_]{1,32}$/)
  for (const u of ITEMS) assert.match(u.key, /^[a-z]{1,12}:[A-Za-z0-9_]{1,32}$/, u.key);
});

test('locker: opens on the first tab with something new, else where you left off', () => {
  const vet: UnlockStats = { ...fresh, level: 12 };
  const { byCat } = lockerCounts(ITEMS, vet, {});
  assert.equal(startTab(byCat, 'theme'), 'tag');
  const none = lockerCounts(ITEMS, fresh, {}).byCat;
  assert.equal(startTab(none, 'effect'), 'effect');
});

test('results: what the run unlocked, in words', () => {
  const [a, b, c] = [item('tag:veteran'), item('color:sky'), item('skin:Neon')];
  assert.equal(unlockSummary([]), '');
  assert.equal(unlockSummary([a]), 'VETERAN tag');
  assert.equal(unlockSummary([a, b]), 'VETERAN tag and Sky name color');
  assert.equal(unlockSummary([a, b, c]), 'VETERAN tag, Sky name color and 1 more');
  assert.equal(unlockSummary([a, b, c], 3), 'VETERAN tag, Sky name color and Neon line skin');
  const parts = unlockParts([a, b, c]);
  assert.deepEqual(parts, [a, ', ', b, ' and 1 more']);
});
