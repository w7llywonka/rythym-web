// The two long-lived engines: Web Audio playback and the gameplay run. Their callbacks reach into the
// screens, which are imported lazily at call time (so there's no load-order problem).
import { AudioEngine } from '../audio.ts';
import { Game } from '../game.ts';
import { finishRun } from './results.ts';
import { go, showToast } from './shell.ts';
import { S, settings } from './state.ts';
import { vsLoadFailed } from './versus.ts';

export const audio = new AudioEngine();

export const game = new Game(audio, {
  settings,
  onFinish: (r, cleared) => finishRun(r, cleared),
  onLoadFail: r => {
    // a 1v1 is forfeited, so the opponent isn't left waiting minutes for the timeout
    if (r.opts?.versus) vsLoadFailed(r.opts.versus.matchId);
    else showToast("Couldn't load that song. Try again.");
    void go('select');
  },
  showGame: (setup, quick) => {
    if (quick && S.screen === 'game') { setup(); return Promise.resolve(); }
    return go('game', setup);
  },
});
