// Shared app state. Everything the screens and panels need to agree on lives here, in one object,
// so modules can read and change it without passing it around.
import type { User } from '../api.ts';
import { PACKS, type Pack, type Tab } from '../config.ts';
import type { RunOpts } from '../game.ts';
import { load as loadLocal, withImportProgress } from '../storage.ts';
import { soundtrack } from '../tracks.ts';
import type { Diff, SaveData, Settings, Track } from '../types.ts';

export type Screen = 'home' | 'select' | 'game' | 'results';

export const S = {
  /** settings, bests, recent songs and profile (the account's copy when logged in), plus this computer's imports */
  data: withImportProgress(loadLocal()) as SaveData,
  account: null as User | null,
  /** no account server here (static hosting / not configured): everyone plays as a guest */
  accountsOffline: false,
  /** Autoplay modifier: session only, never saved */
  autoplay: false,
  /** Practice section (Practice style), in seconds of the selected chart */
  practice: { from: 0, to: null as number | null },

  tracks: soundtrack(),
  tracksById: new Map<string, Track>(),

  screen: 'home' as Screen,
  transitioning: false,
  modal: null as HTMLElement | null,
  tab: 'Easy' as Tab,
  selectedSong: {} as Partial<Record<Tab, Track>>,
  selectedChart: new Map<Track, Diff>(),
  previewTrack: null as Track | null,
  /** the last finished run, for the app's Discord status on the results screen */
  lastResult: null as { title: string; diff: Diff; grade: string; accuracy: number } | null,
  /** what RETRY replays */
  last: { song: null as Track | null, chart: null as Diff | null, opts: undefined as RunOpts | undefined },
};
S.tracksById = new Map(S.tracks.map(t => [t.id, t]));

export const settings = (): Settings => S.data.settings;

export function setTracks(list: Track[]) {
  S.tracks = list;
  S.tracksById = new Map(list.map(t => [t.id, t]));
}

export const packOf = new Map<string, Pack>();
for (const pack of PACKS) for (const id of pack.songs) packOf.set(id, pack);

/** personal bests are stored per song for its own chart, `${id}+` for the "+" chart */
export const bestKey = (t: Track, diff: Diff) => (diff === t.difficulty ? t.id : `${t.id}+`);

/** the chart currently picked for a song (its own tier unless "+" was chosen) */
export function chartFor(t: Track) {
  const diff = S.selectedChart.get(t) ?? t.difficulty;
  return t.charts[diff] ?? t.charts[t.difficulty]!;
}
