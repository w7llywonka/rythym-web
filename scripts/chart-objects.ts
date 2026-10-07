// Writes shared/chart-objects.json: how many judged objects (notes + hold tails) every built-in chart
// has. The server uses it to reject impossible leaderboard scores without generating charts itself.
// Run with `npm run charts` after changing the chart generator (tests/online.test.ts checks it's current).
import { writeFileSync } from 'node:fs';
import { soundtrack } from '../src/tracks.ts';

type Entry = { title: string; difficulty: string; duration: number; charts: Record<string, number> };

export function chartObjects(): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const t of soundtrack()) {
    out[t.id] = { title: t.title, difficulty: t.difficulty, duration: Math.round(t.length * 10) / 10, charts: {} };
    for (const diff of t.chartList) if (t.charts[diff]) out[t.id].charts[diff] = t.charts[diff]!.objects;
  }
  return out;
}

// run directly (not when imported by the test)
if (process.argv[1]?.endsWith('chart-objects.ts')) {
  writeFileSync(new URL('../shared/chart-objects.json', import.meta.url), JSON.stringify(chartObjects(), null, 2) + '\n');
  console.log('wrote shared/chart-objects.json');
}
