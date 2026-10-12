import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGELOG, LATEST, formatDate, newerVersion } from '../src/changelog.ts';
import { K, MODES } from '../src/config.ts';
import {
  INTRO_CUE, SETTLE, STAGES, TUTORIAL_ID, TUTORIAL_LENGTH, TUTORIAL_RECIPE, TUTORIAL_SET, beatTime, cueAt, friendlyName,
  isFirstTimer, onboardingStep, stageEnd, stageStart, stageVerdict, tutorialChart, tutorialTrack, tutorialVerdict,
  type OnboardingState,
} from '../src/onboarding.ts';
import { setMultiplier } from '../src/scoring.ts';
import { songs } from '../src/songs.ts';
import { LEAD_IN, renderRecipe } from '../src/synthesis.ts';

const { notes, groups } = tutorialChart();
const end = (n: { time: number; endTime?: number }) => n.endTime ?? n.time;

test('tutorial chart: in time order, two lanes, all inside the song', () => {
  assert.ok(notes.length >= 30);
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1], b = notes[i];
    assert.ok(a.time < b.time || (a.time === b.time && a.lane < b.lane), `note ${i} out of order`);
  }
  for (const n of notes) {
    assert.ok(n.lane === 1 || n.lane === 2);
    assert.ok(n.time > LEAD_IN && end(n) < TUTORIAL_LENGTH - 2, `note at ${n.time} is outside the song`);
  }
});

test('tutorial chart: has taps in both lanes, chords and holds, and is gentle', () => {
  const chords = notes.filter(n => n.chord);
  const holds = notes.filter(n => n.endTime !== undefined);
  assert.ok(notes.some(n => n.lane === 1 && !n.chord) && notes.some(n => n.lane === 2 && !n.chord));
  assert.ok(chords.length >= 8 && chords.length % 2 === 0, 'chords come in pairs');
  for (const c of chords) assert.ok(chords.some(o => o !== c && o.time === c.time && o.lane !== c.lane), 'a chord is one line in each lane');
  assert.ok(holds.length >= 3);
  for (const h of holds) assert.ok(h.endTime! - h.time >= 1, 'holds are long enough to notice');
  // never two different moments closer than a beat (0.6 s), and nothing lands under a hold in its lane
  const times = [...new Set(notes.map(n => n.time))];
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 0.59, `lines too close at ${times[i]}`);
  for (const lane of [1, 2]) {
    const own = notes.filter(n => n.lane === lane);
    for (let i = 1; i < own.length; i++) assert.ok(own[i].time > end(own[i - 1]) + 0.5, `lane ${lane} crowded at ${own[i].time}`);
  }
});

test('tutorial chart: every note belongs to exactly one line of one stage', () => {
  const seen = new Set<number>();
  groups.forEach((lines, s) => {
    assert.equal(lines.length, STAGES[s].notes.length);
    lines.forEach((idx, i) => {
      assert.equal(idx.length, STAGES[s].notes[i].lane === 3 ? 2 : 1);
      for (const k of idx) {
        assert.ok(!seen.has(k));
        seen.add(k);
        assert.equal(notes[k].time, beatTime(STAGES[s].notes[i].beat));
      }
    });
  });
  assert.equal(seen.size, notes.length);
});

test('tutorial stages: taught in order, one idea at a time', () => {
  assert.equal(STAGES.length, 6);
  const only = (s: number) => STAGES[s].notes;
  assert.ok(only(0).every(n => n.lane === 1 && !n.hold), 'stage 1: Button 1 taps');
  assert.ok(only(1).every(n => n.lane === 2 && !n.hold), 'stage 2: Button 2 taps');
  assert.ok(only(2).every((n, i) => n.lane === (i % 2 ? 2 : 1)), 'stage 3: they alternate');
  assert.ok(only(3).every(n => n.lane === 3), 'stage 4: chords');
  assert.ok(only(4).every(n => n.hold), 'stage 5: holds');
  const mix = only(5);
  assert.ok(mix.some(n => n.lane === 3) && mix.some(n => n.hold) && mix.some(n => n.lane === 1) && mix.some(n => n.lane === 2), 'stage 6: a bit of everything');
  // the button stages name the player's own keys
  const keys = (s: number) => STAGES[s].body.filter(p => typeof p !== 'string').map(p => (p as { key: number }).key);
  assert.deepEqual(keys(0), [0]);
  assert.deepEqual(keys(1), [1]);
  assert.deepEqual(keys(3), [0, 1]);
  // with a chord color that isn't gold, the chord cue doesn't say "gold"
  const re = STAGES[3].recolored!;
  assert.ok(!/gold/i.test(re.title + re.body.join(' ')));
  assert.deepEqual(re.body.filter(p => typeof p !== 'string').map(p => (p as { key: number }).key), [0, 1]);
  assert.ok(INTRO_CUE.title && INTRO_CUE.body.length);
});

test('tutorial cues: up well before the lines arrive, with time to see how a stage went', () => {
  STAGES.forEach((s, i) => {
    const first = beatTime(s.notes[0].beat);
    assert.ok(first - stageStart(s) >= 4, `stage ${i + 1}: only ${(first - stageStart(s)).toFixed(2)} s to read the cue`);
    // the first line only appears (one Easy fall time before it's hit) after the cue has been up a while
    assert.ok(first - MODES.Easy.fall - stageStart(s) >= 2, `stage ${i + 1}: its line shows up too soon`);
    if (i > 0) {
      const result = stageEnd(STAGES[i - 1]) + SETTLE;
      assert.ok(stageStart(s) - result >= 1, `stage ${i}: its result isn't up long enough`);
    }
  });
  assert.deepEqual(cueAt(-3), { stage: -1, done: false });
  assert.deepEqual(cueAt(stageStart(STAGES[0]) - 0.01), { stage: -1, done: false });
  assert.deepEqual(cueAt(beatTime(STAGES[0].notes[0].beat)), { stage: 0, done: false });
  assert.deepEqual(cueAt(stageEnd(STAGES[0]) + SETTLE), { stage: 0, done: true });
  assert.deepEqual(cueAt(stageStart(STAGES[1])), { stage: 1, done: false });
  assert.deepEqual(cueAt(1e9), { stage: STAGES.length - 1, done: true });
});

test('tutorial song: easy tempo, about a minute, and the drums come back for the finale', () => {
  assert.ok(TUTORIAL_RECIPE.bpm >= 96 && TUTORIAL_RECIPE.bpm <= 100);
  assert.deepEqual(TUTORIAL_RECIPE.kick, [0, 4, 8, 12], 'a kick on every beat');
  const total = K.LEAD_IN + Math.max(...notes.map(end));
  assert.ok(total >= 60 && total <= 75, `the tutorial takes ${total.toFixed(1)} s`);
  // the breakdown (no drums) is while the last cue is read; its first line is on the drop
  const bar = 4 * 60 / TUTORIAL_RECIPE.bpm;
  const from = beatTime(TUTORIAL_RECIPE.breakdownAt! * 4), to = from + 2 * bar;
  assert.ok(notes.every(n => end(n) < from || n.time >= to), 'no lines during the breakdown');
  assert.ok(Math.abs(beatTime(STAGES[5].notes[0].beat) - to) < 1e-9, 'the finale starts on the drop');
  assert.ok(stageStart(STAGES[5]) <= from + 1);
  // every line is on a beat (and so on a kick)
  for (const n of notes) {
    const beat = (n.time - LEAD_IN) / (60 / TUTORIAL_RECIPE.bpm);
    assert.ok(Math.abs(beat - Math.round(beat)) < 1e-9);
  }
});

test('tutorial song renders with the soundtrack synth', async () => {
  const ctx = {
    createBuffer(channels: number, length: number, sampleRate: number) {
      const pcm = new Float32Array(length);
      return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, getChannelData: () => pcm } as unknown as AudioBuffer;
    },
  };
  const buffer = await renderRecipe(TUTORIAL_RECIPE, ctx);
  assert.equal(buffer.length, Math.ceil((TUTORIAL_LENGTH + 0.5) * 22050));
  const pcm = buffer.getChannelData(0);
  let peak = 0;
  for (const v of pcm) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
  assert.ok(peak > 0.2 && peak <= 0.78);
  // the beat is loudest on the lines: more energy right after the first line than half a beat later
  const at = (t: number) => { let e = 0; for (let i = 0; i < 1500; i++) e += pcm[Math.round(t * 22050) + i] ** 2; return e; };
  const first = notes[0].time;
  assert.ok(at(first) > at(first + 0.3));
});

test('tutorial track: its own Easy chart, never one of the songs, never ranked', () => {
  const t = tutorialTrack();
  assert.equal(t.id, TUTORIAL_ID);
  assert.equal(t.song.id, TUTORIAL_ID);
  assert.deepEqual(t.chartList, ['Easy']);
  const chart = t.charts.Easy!;
  assert.equal(chart.notes.length, notes.length);
  assert.equal(chart.objects, notes.length + chart.holds);
  assert.ok(!songs.some(s => s.id === TUTORIAL_ID));
  assert.equal(TUTORIAL_SET.style, 'Playground');
  assert.equal(TUTORIAL_SET.auto, false);
  assert.equal(setMultiplier(TUTORIAL_SET).unranked, true);
});

const state = (o: Partial<OnboardingState>): OnboardingState => ({
  plays: 0, tutorialDone: false, offered: false, saveLoaded: true, seenVersion: null, latest: '1.1', ...o,
});

test('onboarding: first-timers get the welcome card once, and skip What\'s New', () => {
  assert.deepEqual(onboardingStep(state({})), { show: 'welcome', markSeen: true });
  assert.deepEqual(onboardingStep(state({ offered: true })), { show: null, markSeen: true });
  assert.deepEqual(onboardingStep(state({ offered: true, seenVersion: '1.0' })), { show: null, markSeen: true });
});

test('onboarding: a returning player is never offered the tutorial, even before their save loads', () => {
  // logged in, account save not loaded (yet / failed): this device's empty guest save says nothing
  assert.equal(onboardingStep(state({ saveLoaded: false })).show, 'whatsnew');
  assert.equal(onboardingStep(state({ saveLoaded: false, seenVersion: '1.1' })).show, null);
  assert.equal(onboardingStep(state({ plays: 12 })).show, 'whatsnew');
  assert.equal(onboardingStep(state({ plays: 0, tutorialDone: true })).show, 'whatsnew');
  assert.ok(!isFirstTimer({ plays: 1, tutorialDone: false }));
  assert.ok(!isFirstTimer({ plays: 0, tutorialDone: true }));
  assert.ok(isFirstTimer({ plays: 0, tutorialDone: false }));
});

test("onboarding: What's New once per version", () => {
  assert.deepEqual(onboardingStep(state({ plays: 3, seenVersion: '1.1' })), { show: null, markSeen: false });
  assert.deepEqual(onboardingStep(state({ plays: 3, seenVersion: '1.0' })), { show: 'whatsnew', markSeen: true });
  assert.equal(onboardingStep(state({ plays: 3, seenVersion: '1.2', latest: '1.1' })).show, null, 'an older build never re-shows');
  assert.ok(newerVersion('1.1', null));
  assert.ok(newerVersion('1.1', '1.0'));
  assert.ok(newerVersion('1.10', '1.9'));
  assert.ok(newerVersion('2', '1.9.9'));
  assert.ok(!newerVersion('1.1', '1.1'));
  assert.ok(!newerVersion('1.1', '1.1.0'));
  assert.ok(!newerVersion('1.1', '1.2'));
});

test('changelog: newest first, well formed, and the latest matches the app', () => {
  assert.equal(LATEST, CHANGELOG[0]);
  const versions = new Set<string>();
  CHANGELOG.forEach((e, i) => {
    assert.match(e.version, /^\d+(\.\d+)*$/);
    assert.ok(!versions.has(e.version));
    versions.add(e.version);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(e.date)));
    assert.ok(e.headline.trim().length > 10 && e.headline.length <= 80, 'the headline fits on one line');
    assert.ok(e.sections.length > 0);
    for (const s of e.sections) {
      assert.ok(s.title.trim() && s.items.length > 0);
      for (const item of s.items) assert.ok(item.trim().length > 10 && item.length < 220, `too long: ${item}`);
    }
    if (i > 0) {
      assert.ok(newerVersion(CHANGELOG[i - 1].version, e.version));
      assert.ok(CHANGELOG[i - 1].date >= e.date);
    }
  });
  const app = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')).version as string;
  assert.ok(app.startsWith(`${LATEST.version}.`) || app === LATEST.version, `desktop app ${app} vs changelog ${LATEST.version}`);
  const text = LATEST.sections.flatMap(s => s.items).join(' ').toLowerCase();
  for (const word of ['tutorial', 'tags', 'name colors', 'line skins', 'hit effects', 'themes', 'hit sound volume', 'menu music',
    'lane dim', 'judgments', 'fps', 'reduce motion', 'achievements', 'drop audio files', 'album folders', 'installer', 'check for updates', 'security']) {
    assert.ok(text.includes(word), `1.1 notes don't mention ${word}`);
  }
  assert.equal(formatDate('2026-10-12'), 'October 12, 2026');
  assert.equal(formatDate('nope'), 'nope');
});

test('greeting: a friendly first name from the computer, or none', () => {
  assert.equal(friendlyName('will'), 'Will');
  assert.equal(friendlyName('will63140'), 'Will');
  assert.equal(friendlyName('john.doe'), 'John');
  assert.equal(friendlyName('WILL'), 'Will');
  assert.equal(friendlyName('McKenzie'), 'McKenzie');
  assert.equal(friendlyName('  zoë '), 'Zoë');
  for (const raw of ['', 'root', 'Administrator', 'user', 'j', '1234', '_svc', null, undefined, 'a'.repeat(30)]) {
    assert.equal(friendlyName(raw), '', String(raw));
  }
});

test('verdicts: kind words for every result', () => {
  assert.equal(stageVerdict(0, 4, 4).title, 'Perfect!');
  assert.deepEqual(stageVerdict(0, 4, 4).body, ['4 of 4. Next up: Button 2.']);
  assert.equal(stageVerdict(2, 4, 8).title, 'Nice!');
  assert.equal(stageVerdict(3, 1, 4).title, 'Keep going');
  assert.match(String(stageVerdict(3, 1, 4).body[0]), /Next up: holds\.$/);
  assert.equal(stageVerdict(STAGES.length - 1, 0, 10).title, 'You did it!');
  for (const s of STAGES) assert.ok(s.teaser.length > 2);
  assert.notEqual(tutorialVerdict(40, 40), tutorialVerdict(10, 40));
  assert.ok(tutorialVerdict(0, 0).length > 0);
});
