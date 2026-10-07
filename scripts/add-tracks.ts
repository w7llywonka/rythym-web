// Builds the licensed tracks listed in scripts/licensed-tracks.json:
//   public/music/<id>.mp3   the audio the game streams. With `--from <folder>` it is (re)made from the
//                           original downloads in that folder: 160 kbps MP3, and for tracks with a
//                           windowSeconds just their busiest stretch (plus a lead-in for the countdown)
//   src/licensed-data.json  songs + onset analysis (beat boundaries, not the full grid), measured on
//                           the shipped MP3 with the same beatmapper the game uses for imports
//   MUSIC-LICENSE.md        the credits section for these tracks
// Run `npm run tracks` (or `npm run tracks -- --from <folder>`), then `npm run charts` so the server's
// score caps include them.
import { Mp3Encoder } from '@breezystack/lamejs';
import decode from 'audio-decode';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gridFromBeats } from '../src/beatgrid.ts';
import { analyzeSamples } from '../src/custom.ts';
import type { Analysis, Credit, Song, Tier } from '../src/types.ts';

interface Entry {
  id: string; title: string; artist: string; genre: string; tier: Tier;
  color: string; color2: string; credit: Credit;
  /** the original download's file name (in the --from folder) */
  original: string;
  /** chart only the busiest stretch of about this many seconds (Extreme tracks) */
  windowSeconds?: number;
  /** first weekly-challenge week it can be picked (set when the song is added) */
  weeklyFrom?: number;
}

const KBPS = 160;
const LEAD_IN = 4; // seconds of music kept before an excerpt: the countdown plays over it
const TAIL = 3;

const root = new URL('../', import.meta.url);
const manifest: Entry[] = JSON.parse(readFileSync(new URL('scripts/licensed-tracks.json', root), 'utf8'));
const fromArg = process.argv.indexOf('--from');
const fromDir = fromArg > 0 ? pathToFileURL(resolve(process.argv[fromArg + 1]) + '/') : null;

type Decoded = Awaited<ReturnType<typeof decode>>;
const mono = (audio: Decoded) => {
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / audio.numberOfChannels;
  }
  return out;
};

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

/** 16-bit stereo MP3 of samples [from, to) */
function encodeMp3(audio: Decoded, from = 0, to = audio.length) {
  const channels = Math.min(2, audio.numberOfChannels);
  const encoder = new Mp3Encoder(channels, audio.sampleRate, KBPS);
  const pcm = Array.from({ length: channels }, (_, c) => {
    const src = audio.getChannelData(c).subarray(from, to);
    const out = new Int16Array(src.length);
    // short fades so a cut never clicks
    const fade = Math.round(audio.sampleRate * 0.02);
    for (let i = 0; i < src.length; i++) {
      const g = from > 0 || to < audio.length ? Math.min(1, i / fade, (src.length - 1 - i) / fade) : 1;
      out[i] = Math.max(-32768, Math.min(32767, Math.round(src[i] * g * 32767)));
    }
    return out;
  });
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm[0].length; i += 1152) {
    const block = encoder.encodeBuffer(pcm[0].subarray(i, i + 1152), channels > 1 ? pcm[1].subarray(i, i + 1152) : undefined);
    if (block.length) chunks.push(new Uint8Array(block.buffer, block.byteOffset, block.length));
  }
  const end = encoder.flush();
  chunks.push(new Uint8Array(end.buffer, end.byteOffset, end.length));
  return Buffer.concat(chunks);
}

const out: { song: Song }[] = [];
for (const e of manifest) {
  const file = `${e.id}.mp3`;
  const shipped = new URL(`public/music/${file}`, root);
  let changes = e.credit.changes;
  if (fromDir) {
    const original = await decode(readFileSync(new URL(e.original, fromDir)));
    const duration = original.length / original.sampleRate;
    let cut: [number, number] = [0, original.length];
    if (e.windowSeconds && duration > e.windowSeconds + LEAD_IN + TAIL + 5) {
      const { analysis } = await analyzeSamples(mono(original), original.sampleRate);
      const w = busiestWindow(analysis, e.windowSeconds, duration);
      cut = [Math.max(0, Math.round((w.start - LEAD_IN) * original.sampleRate)), Math.min(original.length, Math.round((w.end + TAIL) * original.sampleRate))];
    }
    const trimmed = cut[0] > 0 || cut[1] < original.length;
    writeFileSync(shipped, encodeMp3(original, cut[0], cut[1]));
    const kind = e.original.split('.').pop()!.toUpperCase();
    changes = trimmed
      ? `Shortened to a ${Math.round((cut[1] - cut[0]) / original.sampleRate)} s excerpt (${fmt(cut[0] / original.sampleRate)}–${fmt(cut[1] / original.sampleRate)}) and ${kind === 'MP3' ? `re-encoded as ${KBPS} kbps MP3` : `converted from ${kind} to MP3`}`
      : kind === 'MP3' ? `Re-encoded as ${KBPS} kbps MP3` : `Converted from ${kind} to MP3`;
  } else if (!existsSync(shipped)) {
    throw new Error(`public/music/${file} is missing: run with --from <folder with the original downloads>`);
  }

  // analyse exactly what the game will play
  const bytes = readFileSync(shipped);
  const audio = await decode(bytes);
  // the URL carries the file's hash: browsers cache /music/ for a week, so a rebuilt file must get a new URL
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const duration = audio.length / audio.sampleRate;
  const { analysis, warning } = await analyzeSamples(mono(audio), audio.sampleRate);
  // an excerpt is charted from the beat after its lead-in to the beat before its tail; a full-length
  // file is charted on its busiest stretch
  let window: { start: number; end: number } | undefined;
  if (e.windowSeconds) {
    const beats = analysis.beats!;
    const near = (t: number) => beats.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), beats[0]);
    window = duration < e.windowSeconds + LEAD_IN + TAIL + 4
      ? { start: Math.max(0, near(LEAD_IN) - 0.01), end: Math.min(duration, near(duration - TAIL)) }
      : busiestWindow(analysis, e.windowSeconds, duration);
  }
  e.credit = { ...e.credit, ...(changes ? { changes } : {}) };
  delete analysis.grid; // rebuilt from analysis.beats when loaded
  const seed = createHash('sha256').update(e.id).digest().readUInt32BE(0) || 1;
  const credit: Credit = e.credit;
  const song: Song = {
    id: e.id, title: e.title, artist: e.artist, genre: e.genre, bpm: analysis.bpm, duration: Math.round(duration * 1000) / 1000,
    level: 0, difficulty: e.tier, color: e.color, color2: e.color2, audio: `file:/music/${file}?v=${version}`,
    previewStart: Math.round((window ? window.start + Math.min(20, (window.end - window.start) * 0.3) : duration * 0.3) * 100) / 100,
    seed, analysis, credit, ...(window ? { window } : {}), ...(e.weeklyFrom !== undefined ? { weeklyFrom: e.weeklyFrom } : {}),
  };
  out.push({ song });
  console.log(`${e.id.padEnd(20)} ${e.tier.padEnd(8)} ${analysis.bpm.toFixed(1).padStart(6)} BPM  fit ${analysis.gridFit.toFixed(2)}  ${fmt(duration)}` +
    (window ? `  window ${window.start.toFixed(1)}-${window.end.toFixed(1)}s` : '') + `  ${(bytes.length / 1e6).toFixed(1)} MB` + (warning ? `  (${warning})` : ''));
}

function fmt(s: number) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

writeFileSync(new URL('src/licensed-data.json', root), JSON.stringify(out) + '\n');
// remember what was changed from each original, so later runs without --from keep the credit right
if (fromDir) writeFileSync(new URL('scripts/licensed-tracks.json', root), JSON.stringify(manifest, null, 2) + '\n');

// credits section of MUSIC-LICENSE.md (everything above the marker is kept)
const MARK = '<!-- licensed-tracks -->';
const licenseFile = new URL('MUSIC-LICENSE.md', root);
const head = readFileSync(licenseFile, 'utf8').split(MARK)[0].trimEnd();
const lines = out.map(({ song: s }) => {
  const c = s.credit!;
  const by = c.artistUrl ? `[${s.artist}](${c.artistUrl})` : s.artist;
  return `- **"${s.title}"** by ${by} (${s.difficulty}) — from [${c.source}](${c.sourceUrl}), licensed under [${c.license}](${c.licenseUrl}).` +
    (c.attribution ? ` Credit as requested: ${c.attribution}.` : '') +
    ` File: \`public/music/${s.id}.mp3\`. ${c.changes ? `Changes: ${c.changes}.` : 'Unmodified.'}`;
});
writeFileSync(licenseFile, `${head}\n\n${MARK}\n## Licensed tracks\n\nThese songs are by other artists and are used under the licenses below, not under this project's CC0 dedication. Each one was checked on its source page: only CC0 and CC BY are used (no NonCommercial, NoDerivatives or ShareAlike licenses, remixes or re-uploads). Their Expert / Extreme charts are generated from the audio. In the game, every song is credited on the home screen under CREDITS, and its license is shown on its song panel.\n\n${lines.join('\n')}\n`);
console.log(`wrote ${out.length} tracks`);
