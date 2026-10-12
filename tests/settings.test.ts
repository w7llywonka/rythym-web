// Settings helpers (src/app/settingsView.ts), line skins and hit effects (src/look.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { HIT_EFFECTS, NOTE_SKINS } from '../shared/cosmetics.js';
import { choiceHint, cycle, dimText, fpsColor, hudLook, percent, resetSettings, stepTenth } from '../src/app/settingsView.ts';
import { DEFAULT_SETTINGS, HIT_SOUNDS, T } from '../src/config.ts';
import { HIT_EFFECT_IDS, NOTE_STYLES, laneLook, mix, playHitEffect, shade, styleHold, styleNote } from '../src/look.ts';
import type { HitEffect, NoteStyle, Settings } from '../src/types.ts';

test('settings: steppers wrap and clamp', () => {
  assert.equal(cycle(HIT_SOUNDS, 'OFF', -1), 'CLAP');
  assert.equal(cycle(HIT_SOUNDS, 'CLAP', 1), 'OFF');
  assert.equal(cycle(HIT_SOUNDS, 'TICK', 2), 'KICK');
  assert.equal(cycle(NOTE_STYLES, 'Nope' as NoteStyle, 1), NOTE_STYLES[1]);
  assert.equal(stepTenth(0.8, 1), 0.9);
  assert.equal(stepTenth(1, 1), 1);
  assert.equal(stepTenth(0, -1), 0);
  assert.equal(stepTenth(0.7, 1, 0, 0.9), 0.8);
  assert.equal(stepTenth(0.9, 1, 0, 0.9), 0.9);
  // no float drift after many steps
  let v = 0;
  for (let i = 0; i < 7; i++) v = stepTenth(v, 1);
  assert.equal(v, 0.7);
  assert.equal(percent(0.8), '80%');
  assert.equal(dimText(0), 'OFF');
  assert.equal(dimText(0.3), '30%');
});

test('settings: RESET DEFAULTS resets everything but the play style and modifiers', () => {
  const mine: Settings = {
    ...DEFAULT_SETTINGS, keys: ['KeyA', 'KeyL', 'KeyQ'], laneColors: ['#FFFFFF', '#000000'], noteStyle: 'Pixel',
    hitVolume: 0.2, menuMusic: false, laneDim: 0.9, judgeStyle: 'Off', showTiming: false, showMeter: false, showFps: true,
    reduceMotion: true, hitEffect: 'Sparks', theme: 'ocean', scrollSpeed: 2.5,
    style: 'Hardcore', rate: 1.25, hidden: true, mines: true,
  };
  const out = resetSettings(mine);
  for (const key of ['keys', 'laneColors', 'noteStyle', 'hitVolume', 'menuMusic', 'laneDim', 'judgeStyle', 'showTiming',
    'showMeter', 'showFps', 'reduceMotion', 'hitEffect', 'theme', 'scrollSpeed'] as const) {
    assert.deepEqual(out[key], DEFAULT_SETTINGS[key], key);
  }
  assert.equal(out.style, 'Hardcore');
  assert.equal(out.rate, 1.25);
  assert.equal(out.hidden, true);
  assert.equal(out.mines, true);
  // fresh arrays: changing a key later can't change the defaults
  assert.notEqual(out.keys, DEFAULT_SETTINGS.keys);
  assert.notEqual(out.laneColors, DEFAULT_SETTINGS.laneColors);
});

test('settings: judgments Full / Minimal / Off and the timing line', () => {
  const full = hudLook({ judgeStyle: 'Full', showTiming: true });
  assert.deepEqual([full.judge, full.timing, full.size.center, full.size.side], [true, true, 38, 30]);
  const min = hudLook({ judgeStyle: 'Minimal', showTiming: true });
  assert.ok(min.judge && min.timing);
  assert.ok(min.size.center < full.size.center && min.size.side < full.size.side && min.pop < full.pop);
  assert.equal(hudLook({ judgeStyle: 'Full', showTiming: false }).timing, false);
  const off = hudLook({ judgeStyle: 'Off', showTiming: true });
  assert.equal(off.judge, false);
  assert.equal(off.timing, false, 'no timing line without judgments');
});

test('settings: FPS colors and locked hints', () => {
  assert.equal(fpsColor(144), T.muted);
  assert.equal(fpsColor(60), T.muted);
  assert.equal(fpsColor(40), T.gold);
  assert.equal(fpsColor(12), T.red);
  const sparks = HIT_EFFECTS.find(e => e.id === 'Sparks')!;
  assert.equal(choiceHint(sparks, true), sparks.desc);
  assert.equal(choiceHint(sparks, false), 'Sparks  ·  Reach level 10');
});

test('look: colors and lane dim', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(shade('#2BD4FF', 0), '#2BD4FF');
  assert.equal(shade('#2BD4FF', 1), '#000000');
  assert.equal(laneLook(0).field, '#0E0E12');
  assert.match(laneLook(0).lane, /#15151B 100%/);
  const dark = laneLook(0.9);
  assert.equal(dark.field, shade('#0E0E12', 0.9));
  assert.ok(parseInt(dark.field.slice(1), 16) < parseInt(laneLook(0).field.slice(1), 16));
});

// a stand-in for a DOM element: just what the look code touches
interface Fake { style: Record<string, string>; dataset: Record<string, string>; className: string; children: Fake[]; appendChild(c: Fake): Fake; remove(): void; readonly childElementCount: number }
function fake(): Fake {
  const el: Fake = {
    style: {}, dataset: {}, className: '', children: [],
    appendChild(c) { el.children.push(c); return c; },
    remove() {},
    get childElementCount() { return el.children.length; },
  };
  return el;
}

test('look: every line skin has its own look, and restyling clears the last one', () => {
  const seen = new Set<string>();
  for (const style of NOTE_STYLES) {
    const el = fake(), bar = fake();
    styleNote(el as never, bar as never, '#2BD4FF', style, 22, true);
    assert.ok(bar.style.background, style);
    assert.equal(bar.dataset.skin, style);
    seen.add(`${el.style.background}|${bar.style.background}|${bar.style.boxShadow}`);
    const body = fake(), cap = fake();
    styleHold(body as never, cap as never, '#2BD4FF', style);
    assert.ok(body.style.background && cap.style.background, `${style} hold`);
  }
  assert.equal(seen.size, NOTE_STYLES.length, 'no two skins look the same');
  assert.deepEqual(NOTE_STYLES, NOTE_SKINS.map(s => s.id));

  const el = fake(), bar = fake();
  styleNote(el as never, bar as never, '#FF5CA8', 'Pixel', 22, true);
  assert.ok(bar.style.clipPath, 'Pixel has stepped corners');
  styleNote(el as never, bar as never, '#FF5CA8', 'Prism', 22, true);
  assert.equal(bar.style.clipPath, '');
  assert.equal(bar.style.backgroundSize, '200% 100%');
  styleNote(el as never, bar as never, '#FF5CA8', 'Glow', 22, true);
  assert.equal(bar.style.backgroundSize, '');
  // effects off: no outer glow
  styleNote(el as never, bar as never, '#FF5CA8', 'Neon', 22, false);
  assert.ok(!/0 0 20px/.test(bar.style.boxShadow));
});

test('look: hit effects add their pieces (and nothing with None or a crowded layer)', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, raf: g.requestAnimationFrame };
  g.document = { createElement: () => fake() };
  g.requestAnimationFrame = () => 0;
  try {
    const at = { x: 90, y: 522, laneX: 12, laneW: 156, top: 12 };
    const count = (kind: HitEffect, perfect = true) => {
      const layer = fake();
      playHitEffect(layer as never, kind, T.gold, at, perfect);
      return layer.childElementCount;
    };
    assert.deepEqual(HIT_EFFECT_IDS, HIT_EFFECTS.map(e => e.id));
    assert.equal(count('None'), 0);
    assert.equal(count('Ring'), 1);
    assert.equal(count('Burst'), 1);
    assert.equal(count('Sparks'), 13);
    assert.equal(count('Stars'), 6);
    assert.equal(count('Stars', false), 1, 'a small ring when it isn\'t a Perfect');
    assert.equal(count('Shockwave'), 2);
    const busy = fake();
    for (let i = 0; i < 121; i++) busy.appendChild(fake());
    playHitEffect(busy as never, 'Sparks', T.gold, at, true);
    assert.equal(busy.childElementCount, 121);
  } finally {
    g.document = saved.document;
    g.requestAnimationFrame = saved.raf;
  }
});
