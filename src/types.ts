export type Lane = 0 | 1;
export type Difficulty = 'Easy' | 'Hard';
export type Judgment = 'Perfect' | 'Great' | 'Good' | 'Miss';
export type Grade = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export interface Settings { keys: [string, string]; scrollSpeed: number; offsetMs: number; volume: number; effects: boolean }
export interface Analysis { bpm: number; offset: number; low: string; mid: string; high: string; gridFit: number }
export interface Song { id: string; title: string; artist: string; genre: string; bpm: number; duration: number; level: number; difficulty: Difficulty; color: string; color2: string; audio: string; previewStart: number; seed: number; analysis: Analysis }
export interface Note { time: number; lane: Lane; chord: boolean; judged?: Judgment }
export interface Stats { score: number; accuracy: number; combo: number; maxCombo: number; multiplier: number; health: number; counts: Record<Judgment, number> }
export interface Result extends Stats { songId: string; grade: Grade; failed: boolean; fullCombo: boolean; newBest: boolean }
export interface Best { score: number; accuracy: number; maxCombo: number; grade: Grade; fullCombo: boolean }
export type Bests = Record<string, Best>;
export interface GameCallbacks { onStats: (stats: Stats, time: number) => void; onPause: () => void; onResult: (result: Result) => void }
