// Analyses the licensed tracks listed in scripts/licensed-tracks.json (audio in public/music/) with the
// same beatmapper the game uses for imports, and writes:
//   src/licensed-data.json   songs + onset analysis (beat boundaries, not the full grid)
//   MUSIC-LICENSE.md         the credits section for these tracks
// Run `npm run tracks`, then `npm run charts` so the server's score caps include them.
import decode from 'audio-decode';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gridFromBeats } from '../src/beatgrid.ts';
import { analyzeSamples } from '../src/custom.ts';
import type { Analysis, Credit, Song, Tier } from '../src/types.ts';

interface Entry {
  id: string; file: string; title: string; artist: string; genre: string; tier: Tier;
  color: string; color2: string; credit: Credit;
  /** chart only the busiest stretch of about this many seconds (Extreme tracks) */
  windowSeconds?: number;
}

const root = new URL('../', import.meta.url);
const manifest: Entry[] = JSON.parse(readFileSync(new URL('scripts/licensed-tracks.json', root), 'utf8'));

/** the bar-aligned stretch (~seconds long) with the most strong hits */
function busiestWindow(a: Analysis, seconds: number, duration: number) {
  const grid = gridFromBeats(a.beats!, a.low.length);
  const strong = grid.map((_, j) => Math.max(+a.low[j], +a.mid[j], +a.high[j] * 0.8) >= 5 ? 1 + (+a.energy![j]) / 9 : 0);
  const prefix = [0];
  for (const s of strong) prefix.push(prefix[prefix.length - 1] + s);
  const down = a.downbeat ?? 0;
  let best = { score: -1, start: grid[0], end: Math.min(duration, grid[0] + seconds) };
  for (let j = down; j < grid.length; j += 16) {
    let k = j;
    while (k < grid.length && grid[k] - grid[j] < seconds) k += 16; // whole bars
    if (k >= grid.length) break;
    const score = prefix[k] - prefix[j];
    if (score > best.score) best = { score, start: grid[j], end: grid[k] };
  }
  return { start: Math.max(0, best.start - 0.01), end: Math.min(duration, best.end) };
}

const out: { song: Song }[] = [];
for (const e of manifest) {
  const bytes = readFileSync(new URL(`public/music/${e.file}`, root));
  const audio = await decode(bytes);
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
  }
  const duration = audio.length / audio.sampleRate;
  const { analysis, warning } = await analyzeSamples(mono, audio.sampleRate);
  delete analysis.grid; // rebuilt from analysis.beats when loaded
  const window = e.windowSeconds ? busiestWindow(analysis, e.windowSeconds, duration) : undefined;
  const seed = createHash('sha256').update(e.id).digest().readUInt32BE(0) || 1;
  const song: Song = {
    id: e.id, title: e.title, artist: e.artist, genre: e.genre, bpm: analysis.bpm, duration: Math.round(duration * 1000) / 1000,
    level: 0, difficulty: e.tier, color: e.color, color2: e.color2, audio: `file:/music/${e.file}`,
    previewStart: Math.round((window ? window.start + Math.min(20, (window.end - window.start) * 0.3) : duration * 0.3) * 100) / 100,
    seed, analysis, credit: e.credit, ...(window ? { window } : {}),
  };
  out.push({ song });
  console.log(`${e.id.padEnd(22)} ${e.tier.padEnd(8)} ${analysis.bpm.toFixed(1)} BPM  fit ${analysis.gridFit.toFixed(2)}  ${duration.toFixed(0)}s` +
    (window ? `  window ${window.start.toFixed(1)}-${window.end.toFixed(1)}s` : '') + (warning ? `  (${warning})` : ''));
}

writeFileSync(new URL('src/licensed-data.json', root), JSON.stringify(out) + '\n');

// credits section of MUSIC-LICENSE.md (everything above the marker is kept)
const MARK = '<!-- licensed-tracks -->';
const licenseFile = new URL('MUSIC-LICENSE.md', root);
const head = readFileSync(licenseFile, 'utf8').split(MARK)[0].trimEnd();
const lines = manifest.map(e => `- **"${e.title}"** by ${e.artist} (${e.tier}) — [${e.credit.source}](${e.credit.sourceUrl}), licensed under [${e.credit.license}](${e.credit.licenseUrl}). File: \`public/music/${e.file}\`, unmodified.`);
writeFileSync(licenseFile, `${head}\n\n${MARK}\n## Licensed tracks\n\nThese songs are by other artists and are used under the licenses below (not under this project's CC0 dedication). Expert/Extreme charts are generated from the audio; the audio itself is unchanged.\n\n${lines.join('\n')}\n`);
console.log(`wrote ${out.length} tracks`);
