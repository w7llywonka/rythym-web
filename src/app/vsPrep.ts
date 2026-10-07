// Getting a 1v1's song ready in time. The originals synthesize instantly, but licensed songs are
// downloads of a few MB that have to be fetched and decoded first. No DOM in here, so it's tested.

export type PrepState = 'loading' | 'ready' | 'failed';

/** time to show the finish, leave the run and report the score (s), plus slack for the network */
const REPORT_S = 5;

/**
 * Follows the song download for one challenge at a time (the pop-up only shows one).
 * A load that settles after a newer challenge took its place is ignored.
 */
export class SongPrep {
  key = '';
  state: PrepState = 'loading';

  /** start getting `key`'s song ready. Asking again for the same one keeps it going; a failed one is retried. */
  want(key: string, load: () => Promise<unknown>, onChange: (state: PrepState) => void) {
    if (key === this.key && this.state !== 'failed') return;
    this.key = key;
    this.state = 'loading';
    const settle = (state: PrepState) => {
      if (this.key !== key || this.state !== 'loading') return;
      this.state = state;
      onChange(state);
    };
    load().then(() => settle('ready'), () => settle('failed'));
  }

  ready(key: string) { return this.key === key && this.state === 'ready'; }
}

/**
 * The last server moment (ms) a 1v1 run lasting `runSeconds` can start and still report its score
 * before the match's deadline (`endBy`). A run that hasn't started by then can't count anymore.
 */
export const latestStart = (endBy: number, runSeconds: number) => endBy - Math.ceil((runSeconds + REPORT_S) * 1000);
