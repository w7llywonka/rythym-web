// What changed in each version, newest first. The What's New panel (src/app/whatsnew.ts) shows the
// newest entry once per device after an update: add an entry at the top for every release.

export interface ChangeSection { title: string; items: string[] }
export interface ChangeEntry {
  /** "1.1": what the What's New panel remembers having shown */
  version: string;
  /** YYYY-MM-DD */
  date: string;
  headline: string;
  sections: ChangeSection[];
}

export const CHANGELOG: ChangeEntry[] = [
  {
    version: '1.1',
    date: '2026-10-12',
    headline: 'Unlockable looks, a tutorial for new players, and a lot more settings.',
    sections: [
      {
        title: 'New to Line Rush?',
        items: [
          'A one-minute tutorial teaches taps, both buttons, chords and holds, with its own song. Replay it any time with TUTORIAL on the home screen.',
        ],
      },
      {
        title: 'The Locker',
        items: [
          'Unlock tags, name colors, line skins, hit effects and menu themes just by playing: level up, keep a streak, win 1v1s, earn achievements.',
          'Your tag and name color show next to your name on the leaderboards, in the live feed and in 1v1s.',
          'Open it from your profile. New unlocks get a NEW badge.',
        ],
      },
      {
        title: 'Settings',
        items: [
          'Settings are split into tabs: Controls, Audio, Visuals and HUD.',
          'New: hit sound volume, menu music on or off, lane dim, judgments (full, minimal or off), timing in ms, the timing bar, an FPS counter, and reduce motion.',
        ],
      },
      {
        title: 'Achievements',
        items: ['10 new achievements, 22 in all, each with a title to wear.'],
      },
      {
        title: 'Your songs',
        items: [
          'Drop audio files anywhere on the game to import them, on the website too.',
          'The Songs folder in the app reads album folders, one level down.',
        ],
      },
      {
        title: 'Desktop app',
        items: [
          'A new official installer that greets you by name.',
          'Updates show their download progress. CHECK FOR UPDATES in the APP panel, and RESTART TO UPDATE when one is ready.',
          'Security fixes in the app and on the server.',
        ],
      },
    ],
  },
  {
    version: '1.0',
    date: '2026-10-10',
    headline: 'Line Rush comes to Windows, macOS and Linux.',
    sections: [
      {
        title: 'The app',
        items: [
          'Fullscreen, an unlocked frame rate, Discord status and automatic updates.',
          'A Songs folder: drop audio files in and they are imported when you open song select.',
          'Screenshots with F12. Plays offline.',
        ],
      },
      {
        title: 'Online',
        items: ['Leaderboards for every song, King of the Hill, a live feed, and 1v1 battles.'],
      },
    ],
  },
];

export const LATEST = CHANGELOG[0];

/** is version `a` newer than `b`? ("1.10" > "1.9"; anything is newer than nothing) */
export function newerVersion(a: string, b: string | null | undefined): boolean {
  if (!b) return true;
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-10-12" -> "October 12, 2026" (the same in every language setting) */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${d}, ${y}` : date;
}
