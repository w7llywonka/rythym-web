// The first-time tutorial's content (its song, its hand-made chart and the cues that explain it) and
// the onboarding decisions (welcome card or What's New). No DOM here: src/app/tutorial.ts draws it,
// and tests/tutorial.test.ts checks the chart and that every cue is up well before its lines arrive.
import { newerVersion } from './changelog.ts';
import { T } from './config.ts';
import { LEAD_IN, type Recipe } from './synthesis.ts';
import type { Chart, ChartNote, Lane, PlaySet, Song, Track } from './types.ts';

export const TUTORIAL_ID = 'tutorial';
const BPM = 100;
const BEAT = 60 / BPM;
/** song time (seconds) of a beat; beat 0 is the first beat of the music */
export const beatTime = (beat: number) => LEAD_IN + beat * BEAT;

/**
 * The tutorial's song: a bright, easy four-on-the-floor tune, so every line lands on a kick you can hear.
 * The drums drop out (bars 23-24) while the last cue is read and come back for the final mix.
 */
export const TUTORIAL_RECIPE: Recipe = {
  id: TUTORIAL_ID, bpm: BPM, bars: 30, root: 41, minor: false, seed: 4242,
  melody: [0, -1, 4, -1, 7, -1, 4, -1, 9, -1, 7, -1, 4, -1, 2, -1],
  bass: [0, -1, -1, -1, 0, -1, 7, -1, 0, -1, -1, -1, 0, -1, 7, -1],
  kick: [0, 4, 8, 12],
  breakdownAt: 23,
};
export const TUTORIAL_LENGTH = beatTime(TUTORIAL_RECIPE.bars * 4);

/** Playground rules: Easy timing, can't fail, no penalty for extra presses, never saved */
export const TUTORIAL_SET: PlaySet = {
  style: 'Playground', rate: 1, hidden: false, sudden: false, flashlight: false, mirror: false, random: false, wave: false, mines: false, auto: false,
};

// ---- the lesson ----------------------------------------------------------------------------------

/** a cue's text: plain strings, and { key } for the player's own key for that button (drawn as a keycap) */
export type CuePart = string | { key: 0 | 1 };
export interface Cue { title: string; body: CuePart[] }
/** lane 3 = both (a chord); hold = its length in beats */
export interface StageNote { beat: number; lane: 1 | 2 | 3; hold?: number }
export interface Stage extends Cue {
  /** what the stage before says is coming ("Next up: chords.") */
  teaser: string;
  /** the beat the cue appears on (it stays up until the next stage's) */
  cue: number;
  /** the lane to light up while the cue is up: 1, 2, 3 = both, 0 = none */
  spot: 0 | 1 | 2 | 3;
  notes: StageNote[];
  /** said instead when the player changed the color the cue talks about (chords that aren't gold) */
  recolored?: Cue;
}

const F = { key: 0 } as const, J = { key: 1 } as const;
const taps = (lane: 1 | 2 | 3, beats: number[]): StageNote[] => beats.map(beat => ({ beat, lane }));

/** shown during the countdown */
export const INTRO_CUE: Cue = {
  title: "Here's how it works",
  body: ['Lines fall toward your two buttons. Hit each one as it reaches the bright bar.'],
};

// 100 BPM: a beat is 0.6 s. Each cue is up at least 4 s before its first line has to be hit.
export const STAGES: Stage[] = [
  {
    cue: 2, spot: 1, teaser: 'Button 1', title: 'This is Button 1',
    body: ['Press ', F, ' as the line reaches the bright bar.'],
    notes: taps(1, [10, 12, 14, 16]),
  },
  {
    cue: 19, spot: 2, teaser: 'Button 2', title: 'And this is Button 2',
    body: ['Press ', J, ' for the lines in the right lane.'],
    notes: taps(2, [26, 28, 30, 32]),
  },
  {
    cue: 35, spot: 0, teaser: 'both buttons', title: 'Left, right, left, right',
    body: ['Now they take turns: ', F, ' on the left, ', J, ' on the right. It speeds up a little at the end.'],
    notes: [
      ...[42, 44, 46, 48].map((beat, i) => ({ beat, lane: (i % 2 ? 2 : 1) as 1 | 2 })),
      ...[50, 51, 52, 53].map((beat, i) => ({ beat, lane: (i % 2 ? 2 : 1) as 1 | 2 })),
    ],
  },
  {
    cue: 56, spot: 3, teaser: 'chords', title: 'Gold lines are chords',
    body: ['Press ', F, ' and ', J, ' at the same time.'],
    recolored: { title: 'These lines are chords', body: ['When lines come down both lanes together, press ', F, ' and ', J, ' at the same time.'] },
    notes: taps(3, [64, 66, 68, 70]),
  },
  {
    cue: 73, spot: 0, teaser: 'holds', title: 'Hold the long ones',
    body: ['Press as the line arrives, then keep holding until its tail passes the bar.'],
    notes: [{ beat: 80, lane: 1, hold: 2 }, { beat: 84, lane: 2, hold: 2 }, { beat: 88, lane: 1, hold: 2 }],
  },
  {
    cue: 93, spot: 0, teaser: 'the big finish', title: 'Put it all together!',
    body: ["A little bit of everything, right as the beat drops. You've got this."],
    notes: [
      { beat: 100, lane: 1 }, { beat: 102, lane: 2 }, { beat: 103, lane: 1 }, { beat: 104, lane: 2 },
      { beat: 106, lane: 3 }, { beat: 108, lane: 2, hold: 2 },
      { beat: 112, lane: 1 }, { beat: 113, lane: 2 }, { beat: 114, lane: 1 }, { beat: 116, lane: 3 },
    ],
  },
];

/** seconds after a stage's last line before its result shows */
export const SETTLE = 0.4;
export const stageStart = (s: Stage) => beatTime(s.cue);
export const stageEnd = (s: Stage) => Math.max(...s.notes.map(n => beatTime(n.beat + (n.hold ?? 0))));

/** which cue is up at song time `t`: stage -1 is the intro; `done` once the stage's lines are over */
export function cueAt(t: number): { stage: number; done: boolean } {
  let stage = -1;
  for (let i = 0; i < STAGES.length; i++) if (t >= stageStart(STAGES[i])) stage = i;
  if (stage < 0) return { stage, done: false };
  return { stage, done: t >= stageEnd(STAGES[stage]) + SETTLE };
}

/** what the cue says once stage `i` is over (and what's coming next) */
export function stageVerdict(i: number, hit: number, total: number): Cue {
  const next = STAGES[i + 1];
  if (!next) return { title: 'You did it!', body: [`${hit} of ${total}. That's all there is to it.`] };
  const then = `Next up: ${next.teaser}.`;
  if (hit === total) return { title: 'Perfect!', body: [`${hit} of ${total}. ${then}`] };
  if (hit * 2 >= total) return { title: 'Nice!', body: [`${hit} of ${total}. ${then}`] };
  return { title: 'Keep going', body: [`It's practice, so nothing counts against you. ${then}`] };
}

/** the line on the end screen, from how many lines were hit */
export function tutorialVerdict(hit: number, total: number): string {
  const k = total ? hit / total : 0;
  if (k >= 0.95) return "Natural rhythm. The Easy songs won't know what hit them.";
  if (k >= 0.75) return "Great start. A few songs and it'll feel like second nature.";
  return 'Everyone starts somewhere. The Easy songs are the perfect warm-up.';
}

// ---- the chart -----------------------------------------------------------------------------------

/**
 * The chart, in time order, and for each stage which notes make up each of its lines (`groups[stage][i]`
 * = note indices: a chord is two notes, one per lane). A run keeps the chart's order, so the same
 * indices point into `run.notes`.
 */
export function tutorialChart(): { notes: ChartNote[]; groups: number[][][] } {
  const tagged: { note: ChartNote; stage: number; line: number }[] = [];
  STAGES.forEach((s, stage) => s.notes.forEach((n, line) => {
    const time = beatTime(n.beat);
    const endTime = n.hold ? beatTime(n.beat + n.hold) : undefined;
    for (const lane of (n.lane === 3 ? [1, 2] : [n.lane]) as Lane[]) {
      tagged.push({ note: { time, lane, chord: n.lane === 3, ...(endTime !== undefined ? { endTime } : {}) }, stage, line });
    }
  }));
  tagged.sort((a, b) => a.note.time - b.note.time || a.note.lane - b.note.lane);
  const groups = STAGES.map(s => s.notes.map(() => [] as number[]));
  tagged.forEach((t, i) => groups[t.stage][t.line].push(i));
  return { notes: tagged.map(t => t.note), groups };
}

/** the tutorial as a playable track (never added to the song list) */
export function tutorialTrack(): Track {
  const { notes } = tutorialChart();
  const holds = notes.filter(n => n.endTime !== undefined).length;
  const endTime = Math.max(...notes.map(n => n.endTime ?? n.time));
  const chart: Chart = {
    diff: 'Easy', notes, endTime, nps: notes.length / (endTime - notes[0].time), holds, objects: notes.length + holds, level: 1,
  };
  const title = 'First Steps', artist = 'Line Rush', genre = 'Tutorial', seed = TUTORIAL_RECIPE.seed;
  const song: Song = {
    id: TUTORIAL_ID, title, artist, genre, bpm: BPM, duration: TUTORIAL_LENGTH, level: 1, difficulty: 'Easy',
    color: T.cyan, color2: T.pink, audio: `synth:${TUTORIAL_ID}`, previewStart: 0, seed,
    analysis: { bpm: BPM, offset: LEAD_IN, low: '', mid: '', high: '', gridFit: 1 },
  };
  return {
    id: TUTORIAL_ID, title, artist, genre, seed, difficulty: 'Easy', bpm: BPM, displayBpm: BPM, offset: LEAD_IN,
    length: TUTORIAL_LENGTH, displayLength: TUTORIAL_LENGTH, previewStart: 0, color1: T.cyan, color2: T.pink,
    low: '', mid: '', high: '', song, charts: { Easy: chart }, chartList: ['Easy'], level: 1,
  };
}

// ---- who sees what -------------------------------------------------------------------------------

export const isFirstTimer = (p: { plays: number; tutorialDone: boolean }) => !p.tutorialDone && p.plays === 0;

export interface OnboardingState {
  plays: number; tutorialDone: boolean;
  /** the welcome card was already shown on this device */
  offered: boolean;
  /** false while logged in without the account's own save (it failed to load): the player isn't known */
  saveLoaded: boolean;
  /** the last What's New shown on this device (null = never) */
  seenVersion: string | null;
  latest: string;
}

/**
 * After startup: first-timers get the welcome card (once per device) and skip What's New, everyone
 * else gets What's New once per version. A player whose save isn't known is never taken for a new one.
 */
export function onboardingStep(s: OnboardingState): { show: 'welcome' | 'whatsnew' | null; markSeen: boolean } {
  if (s.saveLoaded && isFirstTimer(s)) return { show: s.offered ? null : 'welcome', markSeen: true };
  return newerVersion(s.latest, s.seenVersion) ? { show: 'whatsnew', markSeen: true } : { show: null, markSeen: false };
}

const GENERIC_NAMES = new Set(['user', 'users', 'admin', 'administrator', 'root', 'owner', 'guest', 'default', 'player', 'home', 'test', 'nobody', 'pc', 'me']);

/**
 * A computer account name made friendly for a greeting: "will63140" -> "Will", "john.doe" -> "John",
 * "WILL" -> "Will". Names that aren't a person's ("Administrator", "root", "pc-01") give ''.
 */
export function friendlyName(raw: string | null | undefined): string {
  const word = String(raw ?? '').trim().match(/^[\p{L}][\p{L}\p{M}'’]*/u)?.[0] ?? '';
  if (word.length < 2 || word.length > 20 || GENERIC_NAMES.has(word.toLowerCase())) return '';
  const name = word === word.toUpperCase() ? word.toLowerCase() : word;
  return name[0].toUpperCase() + name.slice(1);
}
