import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPassword, checkUsername, createAuth, parseCookies } from '../api/_lib/core.js';
import { memoryStore } from '../api/_lib/store.js';

// Test-only account (in-memory store, never leaves this process).
const USER = 'tester_one';
const PASS = 'violet-anchor-48-drift';
const NEW_PASS = 'copper-meadow-91-lantern';

// small scrypt cost so the suite stays fast; production uses N = 2^17
const fresh = () => createAuth(memoryStore(), { scrypt: { N: 1024, r: 8, p: 1 } });

type Handler = ReturnType<typeof createAuth>;
function client(handle: Handler, ip = '10.0.0.1') {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    set cookie(v: string) { cookie = v; },
    async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
      const res = await handle({
        method, path, ip, secure: true,
        headers: {
          host: 'linerush.test', origin: 'https://linerush.test', 'x-linerush': '1', 'content-type': 'application/json',
          ...(cookie ? { cookie } : {}), ...headers,
        },
        rawBody: body === undefined ? '' : JSON.stringify(body),
      });
      const set = res.headers['Set-Cookie'];
      if (typeof set === 'string') {
        const [pair] = set.split(';');
        cookie = set.includes('Max-Age=0') ? '' : pair;
      }
      return { status: res.status, body: JSON.parse(res.body), headers: res.headers };
    },
  };
}

test('username and password rules', () => {
  assert.equal(checkUsername('ok_name1'), null);
  for (const bad of ['ab', 'a'.repeat(21), 'has space', 'émile', '<script>', 'Admin', 'GUEST', 42]) assert.ok(checkUsername(bad), String(bad));
  assert.equal(checkPassword(PASS, USER), null);
  assert.ok(checkPassword('short', USER));
  assert.ok(checkPassword('x'.repeat(129), USER));
  assert.ok(checkPassword('aaaaaaaaaaaa', USER));
  assert.ok(checkPassword('Password123', USER), 'common password');
  assert.ok(checkPassword(`my${USER}pass`, USER), 'contains username');
});

test('sign up, stay logged in, save, log out, log back in', async () => {
  const c = client(fresh());
  let r = await c.call('GET', 'auth/me');
  assert.equal(r.status, 401);

  r = await c.call('POST', 'auth/register', { username: USER, password: PASS });
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body.user).sort(), ['createdAt', 'username']);
  const set = r.headers['Set-Cookie'] as string;
  assert.match(set, /^__Host-lr_session=[\w-]{43}; /);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(set.includes(flag), flag);

  r = await c.call('GET', 'auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.username, USER);

  r = await c.call('GET', 'save');
  assert.equal(r.body.data, null);
  r = await c.call('PUT', 'save', { data: { profile: { xp: 77 } } });
  assert.equal(r.status, 200);
  r = await c.call('GET', 'save');
  assert.deepEqual(r.body.data, { profile: { xp: 77 } });

  r = await c.call('POST', 'auth/logout', {});
  assert.equal(r.status, 200);
  assert.equal(c.cookie, '');
  assert.equal((await c.call('GET', 'save')).status, 401);

  // usernames are case-insensitive
  r = await c.call('POST', 'auth/login', { username: USER.toUpperCase(), password: PASS });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.username, USER);
  assert.deepEqual((await c.call('GET', 'save')).body.data, { profile: { xp: 77 } });
});

test('usernames are unique regardless of case', async () => {
  const h = fresh();
  assert.equal((await client(h).call('POST', 'auth/register', { username: USER, password: PASS })).status, 201);
  const r = await client(h, '10.0.0.2').call('POST', 'auth/register', { username: USER.toUpperCase(), password: PASS });
  assert.equal(r.status, 409);
});

test('wrong password and unknown user give the same answer', async () => {
  const h = fresh();
  await client(h).call('POST', 'auth/register', { username: USER, password: PASS });
  const a = await client(h).call('POST', 'auth/login', { username: USER, password: 'not-the-password-1' });
  const b = await client(h).call('POST', 'auth/login', { username: 'nobody_here', password: 'not-the-password-1' });
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, b.body);
});

test('stolen session store contents cannot be used as cookies', async () => {
  const store = memoryStore();
  const h = createAuth(store, { scrypt: { N: 1024, r: 8, p: 1 } });
  const c = client(h);
  await c.call('POST', 'auth/register', { username: USER, password: PASS });
  const [id] = await store.smembers(`usersessions:${USER}`);
  const token = parseCookies(c.cookie)['__Host-lr_session'];
  assert.notEqual(id, token, 'only a hash of the token is stored');
  const thief = client(h);
  thief.cookie = `__Host-lr_session=${id}`;
  assert.equal((await thief.call('GET', 'auth/me')).status, 401);
  const raw = await store.get(`user:${USER}`);
  assert.ok(raw && !raw.includes(PASS), 'password is not stored');
});

test('requests without the CSRF header, from another site, or not JSON are refused', async () => {
  const h = fresh();
  const c = client(h);
  const body = { username: USER, password: PASS };
  assert.equal((await c.call('POST', 'auth/register', body, { 'x-linerush': '' })).status, 403);
  assert.equal((await c.call('POST', 'auth/register', body, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.call('POST', 'auth/register', body, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await c.call('POST', 'auth/register', body, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await c.call('PUT', 'save', { data: 'x'.repeat(200 * 1024) })).status, 413);
  assert.equal((await c.call('GET', 'nope')).status, 404);
});

test('password guessing is rate limited per account', async () => {
  const h = fresh();
  await client(h).call('POST', 'auth/register', { username: USER, password: PASS });
  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) {
    statuses.push((await client(h, `10.1.0.${i}`).call('POST', 'auth/login', { username: USER, password: `wrong-guess-${i}xx` })).status);
  }
  assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
  assert.equal(statuses[8], 429);
  // even the right password waits out the lockout
  assert.equal((await client(h, '10.2.0.1').call('POST', 'auth/login', { username: USER, password: PASS })).status, 429);
});

test('logins are rate limited per IP', async () => {
  const h = fresh();
  const c = client(h, '10.9.9.9');
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await c.call('POST', 'auth/login', { username: `user_${i}`, password: 'whatever-password' })).status;
  assert.equal(last, 429);
});

test('changing the password logs out other devices; delete removes everything', async () => {
  const h = fresh();
  const phone = client(h), laptop = client(h, '10.0.0.5');
  await phone.call('POST', 'auth/register', { username: USER, password: PASS });
  await laptop.call('POST', 'auth/login', { username: USER, password: PASS });
  await phone.call('PUT', 'save', { data: { profile: { xp: 5 } } });

  assert.equal((await phone.call('POST', 'auth/password', { current: 'wrong-current-pw', next: NEW_PASS })).status, 403);
  assert.equal((await phone.call('POST', 'auth/password', { current: PASS, next: NEW_PASS })).status, 200);
  assert.equal((await phone.call('GET', 'auth/me')).status, 200, 'this device stays logged in');
  assert.equal((await laptop.call('GET', 'auth/me')).status, 401, 'other device logged out');
  assert.equal((await laptop.call('POST', 'auth/login', { username: USER, password: PASS })).status, 401);
  assert.equal((await laptop.call('POST', 'auth/login', { username: USER, password: NEW_PASS })).status, 200);

  assert.equal((await phone.call('POST', 'auth/logout-all', {})).status, 200);
  assert.equal((await laptop.call('GET', 'auth/me')).status, 401);

  await phone.call('POST', 'auth/login', { username: USER, password: NEW_PASS });
  assert.equal((await phone.call('POST', 'auth/delete', { password: PASS })).status, 403);
  assert.equal((await phone.call('POST', 'auth/delete', { password: NEW_PASS })).status, 200);
  assert.equal((await phone.call('GET', 'auth/me')).status, 401);
  assert.equal((await phone.call('POST', 'auth/login', { username: USER, password: NEW_PASS })).status, 401);
  // the name is free again
  assert.equal((await client(h, '10.0.0.8').call('POST', 'auth/register', { username: USER, password: PASS })).status, 201);
  assert.equal((await client(h, '10.0.0.8').call('GET', 'save')).status, 401);
});
