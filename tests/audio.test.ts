import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the production audio controller with a stubbed synthesizer. These
// timing and cancellation tests do not need to allocate PCM or run a browser.
const source = await readFile(new URL('../src/audio.ts', import.meta.url), 'utf8');
const synthesisImport = "import { renderSong } from './synthesis.ts';";
assert.ok(source.includes(synthesisImport), 'Audio test must isolate the synthesis import');
const javascript = stripTypeScriptTypes(source.replace(synthesisImport,
  'const renderSong = async () => { throw new Error("Tests must supply a fake buffer"); };'));
const { AudioEngine } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));

function createEngine() {
  const sources: { stopped: number; disconnected: number; starts: [number, number][] }[] = [];
  const context = {
    currentTime: 100,
    outputLatency: 0.04,
    baseLatency: 0.01,
    state: 'running',
    createBufferSource() {
      const source = {
        stopped: 0,
        disconnected: 0,
        starts: [] as [number, number][],
        buffer: null,
        connect() {},
        disconnect() { this.disconnected += 1; },
        stop() { this.stopped += 1; },
        start(at: number, position: number) { this.starts.push([at, position]); },
      };
      sources.push(source);
      return source;
    },
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 1 } }; },
  };
  const engine = new AudioEngine();
  engine.context = context;
  engine.load = async () => ({ duration: 60 });
  return { engine, context, sources };
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `Expected ${actual} to equal ${expected}`);
}

test('pausing in a resume countdown retains the last played position', async () => {
  const { engine, context, sources } = createEngine();
  await engine.play({ id: 'song' }, 20, 2);
  assert.deepEqual(sources[0].starts, [[102, 20]]);
  context.currentTime = 100.5;
  assert.equal(engine.countdown, 1.5);
  assert.equal(engine.pause(), 20);
  assert.equal(sources[0].stopped, 1);
  await engine.play({ id: 'song' }, 20, 2);
  assert.deepEqual(sources[1].starts, [[102.5, 20]]);
  context.currentTime = 100.75;
  assert.equal(engine.pause(), 20);
});

test('a stale play cannot replace or stop a newer active source', async () => {
  const { engine, sources } = createEngine();
  await engine.play({ id: 'first' });
  let release!: (buffer: { duration: number }) => void;
  let wanted = true;
  engine.load = () => new Promise(resolve => { release = resolve; });
  const stale = engine.play({ id: 'stale' }, 0, 3, () => wanted);
  wanted = false;
  engine.load = async () => ({ duration: 60 });
  await engine.play({ id: 'newer' }, 10, 2);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].stopped, 1);
  release({ duration: 60 });
  await stale;
  assert.equal(sources.length, 2, 'Stale play must not allocate a third source');
  assert.equal(sources[1].stopped, 0, 'Stale play must not stop the current source');
  assert.equal(sources[1].disconnected, 0);
  assert.deepEqual(sources[1].starts, [[102, 10]]);
});

test('audible time subtracts output latency and freezes while paused', async () => {
  const { engine, context } = createEngine();
  await engine.play({ id: 'song' }, 20, 2);
  close(engine.time, 17.96);
  context.currentTime = 104;
  close(engine.rawTime, 22);
  close(engine.time, 21.96);
  assert.equal(engine.countdown, 0);
  const position = engine.pause();
  assert.equal(position, 22);
  context.currentTime = 107;
  close(engine.time, 21.96);
  await engine.play({ id: 'song' }, position, 2);
  context.currentTime = 109;
  close(engine.time, 21.96);
});
