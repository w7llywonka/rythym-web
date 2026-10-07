// Saving: guests save in this browser (localStorage), logged-in players save to their account.
import { api } from '../api.ts';
import { save as saveLocal } from '../storage.ts';
import { signedOut } from './accounts.ts';
import { game } from './services.ts';
import { S } from './state.ts';

let timer: number | undefined;
/** shown in the Account panel */
export let syncState = '';
/**
 * false until the account's own save has been read. Until then nothing is written to the server,
 * so a failed load can never overwrite the account with this browser's guest progress.
 */
let accountLoaded = false;

export function setAccountLoaded(loaded: boolean, state = '') {
  accountLoaded = loaded;
  syncState = state;
}

async function flush() {
  timer = undefined;
  if (S.account && accountLoaded) {
    const res = await api.putSave(S.data);
    syncState = res.ok ? 'Progress saved to your account' : `Couldn't sync: ${res.error}`;
    if (res.status === 401) signedOut();
  } else if (!S.account) {
    saveLocal(S.data);
  }
}

/** save soon (changes in quick succession are batched) */
export function queueSave() {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), 1200);
}

/** save right now (before logging out) */
export async function saveNow() {
  if (timer) clearTimeout(timer);
  await flush();
}

const beacon = (path: string, body: unknown) =>
  void fetch(path, { method: path === '/api/save' ? 'PUT' : 'POST', keepalive: true, credentials: 'same-origin', headers: { 'X-LineRush': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});

export function initSave() {
  window.addEventListener('pagehide', () => {
    // closing the tab mid-battle counts as leaving
    const r = game.run;
    if (r?.opts?.versus && !r.ended) beacon('/api/versus/forfeit', { matchId: r.opts.versus.matchId });
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
      if (S.account && accountLoaded) beacon('/api/save', { data: S.data });
      else if (!S.account) saveLocal(S.data);
    }
  });
}
