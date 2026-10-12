// Unlockable cosmetics (shared/cosmetics.js) and the new save fields that go with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HIT_EFFECTS, NAME_COLORS, NOTE_SKINS, TAGS, THEMES, TITLES, cleanNameColor, cleanTag, cleanTitle, describeRule, isUnlocked } from '../shared/cosmetics.js';
import { ACHIEVEMENTS, DEFAULT_SETTINGS } from '../src/config.ts';
import { SAVE_VERSION, sanitize } from '../src/storage.ts';

const ALL = [...TAGS, ...NAME_COLORS, ...NOTE_SKINS, ...HIT_EFFECTS, ...THEMES];
const none = { level: 1, plays: 0, streak: 0, fcs: 0, ss: 0, vsWins: 0, imports: 0, kings: 0, tops: 0, tutorialDone: false, since: 0, achievements: {} };

test('cosmetics: unique ids, readable unlock rules, achievements that exist', () => {
  for (const list of [TAGS, NAME_COLORS, NOTE_SKINS, HIT_EFFECTS, THEMES]) {
    assert.equal(new Set(list.map(i => i.id)).size, list.length);
  }
  const achievementIds = new Set(ACHIEVEMENTS.map(a => a.id));
  for (const item of ALL) {
    assert.ok(describeRule(item.unlock).length > 0, item.id);
    if (item.unlock.kind === 'achievement') assert.ok(achievementIds.has(item.unlock.id), `${item.id} needs achievement ${item.unlock.id}`);
  }
  for (const t of TAGS) assert.match(t.label, /^[A-Z0-9# ]{1,12}$/, t.id);
  for (const c of [...TAGS, ...NAME_COLORS]) assert.match(c.color, /^#[0-9A-F]{6}$/, c.id);
  assert.equal(new Set(ACHIEVEMENTS.map(a => a.id)).size, ACHIEVEMENTS.length);
});

test('cosmetics: rules follow progress', () => {
  const free = ALL.filter(i => isUnlocked(i.unlock, none)).map(i => i.id);
  assert.ok(free.includes('Glow') && free.includes('Ring') && free.includes('default'));
  assert.ok(!free.includes('veteran'));
  const vet = { ...none, level: 10, streak: 7, tutorialDone: true, vsWins: 1, since: 20738, achievements: { combo_500: true as const } };
  const tags = TAGS.filter(t => isUnlocked(t.unlock, vet)).map(t => t.id);
  for (const id of ['graduate', 'veteran', 'onfire', 'duelist', 'og', 'combo']) assert.ok(tags.includes(id), id);
  assert.ok(!tags.includes('elite') && !tags.includes('king'));
  assert.equal(isUnlocked(TAGS.find(t => t.id === 'og')!.unlock, { ...none, since: 20819 }), false, 'from 2027 on, no OG tag');
});

test('cosmetics: the server only accepts known ids', () => {
  assert.equal(cleanTag('veteran'), 'veteran');
  assert.equal(cleanTag('<script>'), '');
  assert.equal(cleanTag(42), '');
  assert.equal(cleanNameColor('gold'), 'gold');
  assert.equal(cleanNameColor('default'), '');
  assert.equal(cleanNameColor('__proto__'), '');
});

test('titles: the server list is exactly the achievement titles', () => {
  const fromAchievements = ACHIEVEMENTS.map(a => a.title);
  for (const t of fromAchievements) assert.ok(TITLES.includes(t), `TITLES is missing "${t}"`);
  for (const t of TITLES) assert.ok(fromAchievements.includes(t), `"${t}" is no achievement's title`);
  assert.equal(new Set(TITLES).size, TITLES.length);
  assert.equal(cleanTitle('Godlike'), 'Godlike');
  for (const bad of ['Line Rush Staff', 'godlike', 'Godlike ', '', 42, null]) assert.equal(cleanTitle(bad), '', String(bad));
});

test('save: new settings and profile fields are sanitized, old saves get defaults', () => {
  const old = sanitize({ settings: { scrollSpeed: 2 }, profile: { xp: 500 } });
  assert.equal(old.v, SAVE_VERSION);
  assert.equal(old.settings.hitVolume, DEFAULT_SETTINGS.hitVolume);
  assert.equal(old.settings.menuMusic, true);
  assert.equal(old.settings.hitEffect, 'Ring');
  assert.equal(old.profile.tag, '');
  assert.equal(old.profile.tutorialDone, false);
  assert.deepEqual(old.profile.seen, {});

  const d = sanitize({
    settings: { hitVolume: 7, laneDim: 0.55, judgeStyle: 'Loud', showTiming: false, showFps: 'yes', hitEffect: 'Sparks', theme: 'ocean', noteStyle: 'Prism' },
    profile: { tag: 'veteran', nameColor: 'javascript:x', vsWins: -3, imports: 2.7, tutorialDone: 'true', since: 20000, seen: { 'tag:veteran': true, 'bad key': true, 'tag:x': 'yes' } },
  });
  assert.equal(d.settings.hitVolume, 1);
  assert.equal(d.settings.laneDim, 0.6);
  assert.equal(d.settings.judgeStyle, 'Full');
  assert.equal(d.settings.showTiming, false);
  assert.equal(d.settings.showFps, false);
  assert.equal(d.settings.hitEffect, 'Sparks');
  assert.equal(d.settings.theme, 'ocean');
  assert.equal(d.settings.noteStyle, 'Prism', 'a skin is kept; whether it is unlocked is checked when it is used');
  assert.equal(d.profile.tag, 'veteran');
  assert.equal(d.profile.nameColor, '');
  assert.equal(d.profile.vsWins, 0);
  assert.equal(d.profile.imports, 2);
  assert.equal(d.profile.tutorialDone, false);
  assert.equal(d.profile.since, 20000);
  assert.deepEqual(d.profile.seen, { 'tag:veteran': true });
});
