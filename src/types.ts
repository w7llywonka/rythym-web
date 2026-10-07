export type Lane = 1 | 2;
export type Tier = 'Easy' | 'Hard' | 'Expert' | 'Extreme';
export type Diff = Tier | 'Insane';
export type Grade = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export type StyleName = 'Classic' | 'Hardcore' | 'SuddenDeath' | 'Playground' | 'Practice';
export type ModKey = 'hidden' | 'sudden' | 'flashlight' | 'mirror' | 'random' | 'wave' | 'mines' | 'auto';
export type HitSound = 'OFF' | 'TICK' | 'MANIA' | 'KICK' | 'CLAP';

/** Onset analysis: one digit (0-9) per 16th step for kick/bass, snare/mids and hats/highs. */
export interface Analysis { bpm: number; offset: number; low: string; mid: string; high: string; gridFit: number }

/** A record in song-data.json (the original soundtrack) or a custom import. */
export interface Song {
  id: string; title: string; artist: string; genre: string; bpm: number; duration: number; level: number;
  difficulty: Tier; color: string; color2: string; audio: string; previewStart: number; seed: number; analysis: Analysis;
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
  scrollSpeed: number; offset: number; musicVolume: number; effects: boolean; centerHud: boolean; hitZone: boolean; hitSound: HitSound;
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
