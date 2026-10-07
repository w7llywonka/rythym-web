export type Lane = 1 | 2;
export type Tier = 'Easy' | 'Hard' | 'Expert' | 'Extreme';
export type Diff = Tier | 'Insane';
export type Grade = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export type StyleName = 'Classic' | 'Hardcore' | 'SuddenDeath' | 'Playground' | 'Practice';
export type ModKey = 'hidden' | 'sudden' | 'flashlight' | 'mirror' | 'random' | 'wave' | 'mines' | 'auto';
export type HitSound = 'OFF' | 'TICK' | 'MANIA' | 'KICK' | 'CLAP';
export type NoteStyle = 'Glow' | 'Flat' | 'Outline' | 'Classic';

/** Onset analysis: one digit (0-9) per 16th step for kick/bass, snare/mids and hats/highs. */
/**
 * Onset grid of a song: one digit (0-9) per 16th-note step for low / mid / high band hit strength.
 * Imports also carry a beat-tracked grid (exact time of every step), the step of the first
 * downbeat, how long a sound is held after each step (base-36, in steps) and section energy (0-9).
 */
export interface Analysis {
  bpm: number; offset: number; low: string; mid: string; high: string; gridFit: number;
  grid?: number[]; downbeat?: number; sustain?: string; energy?: string;
  /** beat boundaries the grid is built from (stored instead of the grid for bundled tracks) */
  beats?: number[];
}

/** credit for a licensed (non-original) track; shown in game and in MUSIC-LICENSE.md */
export interface Credit { license: string; licenseUrl: string; source: string; sourceUrl: string }

/** A record in song-data.json (the original soundtrack) or a custom import. */
export interface Song {
  id: string; title: string; artist: string; genre: string; bpm: number; duration: number; level: number;
  difficulty: Tier; color: string; color2: string; audio: string; previewStart: number; seed: number; analysis: Analysis;
  /** licensed tracks: who made it and under which license */
  credit?: Credit;
  /** licensed Extreme tracks are charted on their busiest stretch (seconds) */
  window?: { start: number; end: number };
}

export interface ChartNote { time: number; lane: Lane; chord: boolean; strength?: number; endTime?: number }

export interface Chart {
  diff: Diff; notes: ChartNote[]; endTime: number; nps: number; holds: number; objects: number; level: number;
}

/** A playable track with its generated charts (own tier + one step harder). */
export interface Track {
  id: string; title: string; artist: string; genre: string; seed: number; difficulty: Tier;
  bpm: number; displayBpm: number; offset: number; length: number; displayLength: number; previewStart: number;
  color1: string; color2: string; low: string; mid: string; high: string;
  grid?: number[]; downbeat?: number; sustain?: string; energy?: string;
  chartStart?: number; chartEnd?: number; custom?: boolean;
  song: Song; charts: Partial<Record<Diff, Chart>>; chartList: Diff[]; level: number;
}

/** Everything that changes how a run plays (style, speed, modifiers). */
export interface PlaySet {
  style: StyleName; rate: number;
  hidden: boolean; sudden: boolean; flashlight: boolean; mirror: boolean; random: boolean; wave: boolean; mines: boolean; auto: boolean;
}

export interface Settings {
  keys: [string, string, string];
  scrollSpeed: number; offset: number; musicVolume: number; effects: boolean; centerHud: boolean; hitZone: boolean;
  laneColors: [string, string]; chordColor: string; noteStyle: NoteStyle; noteSize: number; hitSound: HitSound;
  style: StyleName; rate: number;
  hidden: boolean; sudden: boolean; flashlight: boolean; mirror: boolean; random: boolean; wave: boolean; mines: boolean;
}

export interface Best { score: number; accuracy: number; combo: number; grade: Grade; fc: boolean }
export type Bests = Record<string, Best>;
export interface RecentEntry { id: string; chart: Diff }

export interface Profile {
  xp: number; plays: number; notesHit: number; fcs: number; ss: number; playSeconds: number;
  streak: number; bestStreak: number; lastDay: number; title: string;
  achievements: Record<string, true>; packs: Record<string, true>;
  weekly: Record<string, number>;
}

export interface SaveData { settings: Settings; bests: Bests; recent: RecentEntry[]; profile: Profile }
