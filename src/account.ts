// Client for the account API (/api/*). The session lives in an HttpOnly cookie the page can't read;
// every request carries the X-LineRush header, which the server requires as a CSRF guard.

export interface User { username: string; createdAt: number }

export interface VsResult { outcome: 'win' | 'lose' | 'draw'; reason: 'done' | 'forfeit' | 'timeout'; you: number; them: number }
export interface VsMatch {
  id: string; songId: string; diff: string; startAt: number; endBy: number; opponent: string;
  opp: { score: number; combo: number; health: number; accuracy: number } | null; oppDone: number | null; result: VsResult | null;
}
export type VsEvent = { type: 'declined'; by: string } | { type: 'react'; i: number } | { type: 'opponentDone'; score: number } | { type: 'forfeit' } | { type: 'start'; matchId: string };
export interface VsPoll {
  now: number; match: VsMatch | null; events: VsEvent[];
  incoming: { from: string; songId: string; diff: string; expiresIn: number } | null;
  online?: { name: string; busy: boolean }[];
}
export interface ApiResult<T> { ok: boolean; status: number; data?: T; error?: string }

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-LineRush': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: Record<string, unknown> = {};
    try { json = await res.json(); } catch { /* empty body */ }
    if (!res.ok) return { ok: false, status: res.status, error: typeof json.error === 'string' ? json.error : `Something went wrong (${res.status}).` };
    return { ok: true, status: res.status, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "Can't reach the server. Check your connection." };
  }
}

export const api = {
  me: () => call<{ user: User }>('GET', 'auth/me'),
  register: (username: string, password: string) => call<{ user: User }>('POST', 'auth/register', { username, password }),
  login: (username: string, password: string) => call<{ user: User }>('POST', 'auth/login', { username, password }),
  logout: () => call<{ ok: true }>('POST', 'auth/logout', {}),
  logoutAll: () => call<{ ok: true }>('POST', 'auth/logout-all', {}),
  changePassword: (current: string, next: string) => call<{ ok: true }>('POST', 'auth/password', { current, next }),
  deleteAccount: (password: string) => call<{ ok: true }>('POST', 'auth/delete', { password }),
  loadSave: () => call<{ data: unknown; updatedAt: number | null }>('GET', 'save'),
  putSave: (data: unknown) => call<{ ok: true; updatedAt: number }>('PUT', 'save', { data }),
  // 1v1
  vsPoll: (query: { lobby?: boolean; match?: string }) => {
    const q = new URLSearchParams();
    if (query.lobby) q.set('lobby', '1');
    if (query.match) q.set('match', query.match);
    return call<VsPoll>('GET', `versus/poll${q.size ? `?${q}` : ''}`);
  },
  vsChallenge: (to: string, songId: string, diff: string) => call<{ ok: true; to: string }>('POST', 'versus/challenge', { to, songId, diff }),
  vsRespond: (from: string, accept: boolean) => call<{ ok: true; now?: number; match?: VsMatch }>('POST', 'versus/respond', { from, accept }),
  vsProgress: (matchId: string, p: { score: number; combo: number; health: number; accuracy: number }) => call<VsPoll>('POST', 'versus/progress', { matchId, ...p }),
  vsReact: (matchId: string, i: number) => call<{ ok: true }>('POST', 'versus/react', { matchId, i }),
  vsFinal: (matchId: string, score: number, cleared: boolean) => call<{ ok: true; match: VsMatch }>('POST', 'versus/final', { matchId, score, cleared }),
  vsForfeit: (matchId: string) => call<{ ok: true }>('POST', 'versus/forfeit', { matchId }),
};

/** Same rules the server enforces, checked early for friendlier messages. */
export function validateUsername(name: string): string | null {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return 'Usernames are 3-20 letters, numbers or _.';
  return null;
}

export function validatePassword(password: string, username: string): string | null {
  if (password.length < 10) return 'Passwords need at least 10 characters.';
  if (password.length > 128) return 'Passwords can be at most 128 characters.';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return "Your password can't contain your username.";
  if (/^(.)\1+$/.test(password)) return 'Pick a password that is less predictable.';
  return null;
}
