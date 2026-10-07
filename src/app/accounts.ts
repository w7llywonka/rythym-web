// Accounts: log in / sign up, the Account panel (password, log out, delete), and restoring a session.
import { api, validatePassword, validateUsername, type User } from '../api.ts';
import { T } from '../config.ts';
import { load as loadLocal, sanitize, withImportProgress, withoutImports } from '../storage.ts';
import { $, show, txt } from '../ui.ts';
import { refreshFeed, refreshHome, refreshWeekly } from './home.ts';
import { playPreview } from './preview.ts';
import { saveNow, setAccountLoaded, syncState } from './save.ts';
import { buildList } from './select.ts';
import { refreshSettings } from './settingsPanel.ts';
import { closeModal, onClick, openModal, showToast } from './shell.ts';
import { S } from './state.ts';
import { vsReset, vsSchedule } from './versus.ts';

const GUEST_KEY = 'lineRush.guest';
let mode: 'login' | 'signup' = 'login';
let busy = false;
const field = (name: string) => $(`auth.form.${name}`) as HTMLInputElement;
const acctField = (name: string) => $(`account.${name}`) as HTMLInputElement;

function setMode(next: 'login' | 'signup') {
  mode = next;
  const signup = next === 'signup';
  $('auth.form.tabs.highlight').style.left = signup ? '200px' : '4px';
  $('auth.form.tabs.login').style.color = signup ? T.muted : T.bg0;
  $('auth.form.tabs.signup').style.color = signup ? T.bg0 : T.muted;
  show($('auth.form.clabel'), signup);
  show(field('confirm'), signup);
  $('auth.form.error').style.top = signup ? '432px' : '360px';
  $('auth.form.submit').style.top = signup ? '470px' : '404px';
  $('auth.form.guest').style.top = signup ? '536px' : '474px';
  $('auth.form.note').style.top = signup ? '584px' : '524px';
  $('auth').style.height = signup ? '620px' : '560px';
  field('password').autocomplete = signup ? 'new-password' : 'current-password';
  field('password').placeholder = signup ? 'At least 10 characters' : 'Your password';
  txt($('auth.form.submit'), signup ? 'CREATE ACCOUNT' : 'LOG IN');
  txt($('auth.form.sub'), signup ? 'Make an account to keep your progress everywhere' : 'Log in to save your progress');
  txt($('auth.form.error'), '');
}

export function openAuth(start: 'login' | 'signup' = 'login') {
  setMode(start);
  field('password').value = '';
  field('confirm').value = '';
  openModal($('auth'));
  setTimeout(() => field('username').focus(), 50);
}

async function submit() {
  if (busy) return;
  const username = field('username').value.trim();
  const password = field('password').value;
  const err = (text: string) => txt($('auth.form.error'), text);
  const uErr = validateUsername(username);
  if (uErr) return err(uErr);
  if (mode === 'signup') {
    const pErr = validatePassword(password, username);
    if (pErr) return err(pErr);
    if (password !== field('confirm').value) return err("Those passwords don't match.");
  } else if (!password) return err('Enter your password.');
  busy = true;
  err('');
  const label = mode === 'signup' ? 'CREATE ACCOUNT' : 'LOG IN';
  txt($('auth.form.submit'), mode === 'signup' ? 'CREATING...' : 'LOGGING IN...');
  const res = mode === 'signup' ? await api.register(username, password) : await api.login(username, password);
  busy = false;
  txt($('auth.form.submit'), label);
  if (!res.ok || !res.data) return err(res.error ?? 'Something went wrong.');
  field('password').value = '';
  field('confirm').value = '';
  await signedIn(res.data.user, mode === 'signup');
}

/** after logging in: the account's save is the source of truth; a new account adopts this browser's guest progress */
async function signedIn(user: User, fresh: boolean) {
  S.account = user;
  setAccountLoaded(false);
  let res = await api.loadSave();
  if (!res.ok && res.status !== 401) res = await api.loadSave(); // one retry on a network blip
  if (res.ok) {
    if (res.data?.data) S.data = withImportProgress(sanitize(res.data.data));
    else {
      S.data = withImportProgress(loadLocal());
      await api.putSave(withoutImports(S.data));
    }
    setAccountLoaded(true, 'Progress is saved to your account');
  } else {
    // keep playing, but never write over the account with progress it didn't load
    setAccountLoaded(false, "Couldn't load your progress. It won't sync until you log in again.");
    showToast("Couldn't load your saved progress right now.");
  }
  vsSchedule(300);
  closeModal();
  showToast(fresh ? `Welcome to Line Rush, ${user.username}!` : `Welcome back, ${user.username}!`);
  afterDataChange();
}

/** the server says the session is gone (or the player logged out): back to guest progress */
export function signedOut() {
  S.account = null;
  setAccountLoaded(false);
  vsReset();
  S.data = withImportProgress(loadLocal());
  afterDataChange();
}

function afterDataChange() {
  refreshSettings();
  refreshHome();
  refreshWeekly();
  void refreshFeed();
  if (S.screen === 'select') buildList();
}

export function openAccount() {
  if (!S.account) return openAuth();
  txt($('account.user'), S.account.username);
  txt($('account.since'), `Member since ${new Date(S.account.createdAt).toLocaleDateString()}`);
  txt($('account.sync'), syncState);
  txt($('account.msg'), '');
  for (const n of ['current', 'next', 'confirm']) acctField(n).value = '';
  openModal($('account'));
}

const acctMsg = (text: string, color = T.muted) => { txt($('account.msg'), text); $('account.msg').style.color = color; };

/** restore a session if there is one; otherwise offer log in / sign up (or remember "guest") */
export async function restoreSession() {
  const res = await api.me();
  if (res.ok && res.data?.user) return signedIn(res.data.user, false);
  if (res.status !== 401) {
    S.accountsOffline = true; // no account server here (static hosting / not configured)
    refreshWeekly();
    void refreshFeed();
    return;
  }
  let guest: string | null = null;
  try { guest = localStorage.getItem(GUEST_KEY); } catch { /* blocked storage */ }
  if (!guest) openAuth('login');
}

export function initAccounts() {
  onClick('auth.form.tabs.login', () => setMode('login'));
  onClick('auth.form.tabs.signup', () => setMode('signup'));
  onClick('auth.form.submit', () => void submit());
  onClick('auth.form.guest', () => {
    try { localStorage.setItem(GUEST_KEY, '1'); } catch { /* private mode */ }
    closeModal();
    void playPreview(S.previewTrack ?? S.selectedSong.Easy);
  });
  for (const name of ['username', 'password', 'confirm']) {
    field(name).addEventListener('keydown', e => { if (e.key === 'Enter') void submit(); });
  }

  onClick('account.close', closeModal);
  onClick('account.change', async () => {
    if (!S.account) return;
    const current = acctField('current').value, next = acctField('next').value;
    const pErr = validatePassword(next, S.account.username);
    if (!current) return acctMsg('Enter your current password.', T.red);
    if (pErr) return acctMsg(pErr, T.red);
    if (next !== acctField('confirm').value) return acctMsg("The new passwords don't match.", T.red);
    acctMsg('Updating...');
    const res = await api.changePassword(current, next);
    if (!res.ok) return acctMsg(res.error ?? 'Something went wrong.', T.red);
    for (const n of ['current', 'next', 'confirm']) acctField(n).value = '';
    acctMsg('Password updated. Other devices were logged out.', T.green);
  });
  onClick('account.logout', async () => {
    await saveNow();
    await api.logout();
    closeModal();
    signedOut();
    showToast('Logged out');
  });
  onClick('account.logoutall', async () => {
    await saveNow();
    const res = await api.logoutAll();
    if (!res.ok) return acctMsg(res.error ?? 'Something went wrong.', T.red);
    closeModal();
    signedOut();
    showToast('Logged out on every device');
  });
  onClick('account.delete', async () => {
    const password = acctField('current').value;
    if (!password) return acctMsg('Type your current password above to delete your account.', T.red);
    if (!window.confirm('Delete your Line Rush account and all its progress? This cannot be undone.')) return;
    const res = await api.deleteAccount(password);
    if (!res.ok) return acctMsg(res.error ?? 'Something went wrong.', T.red);
    closeModal();
    signedOut();
    showToast('Your account was deleted');
  });
}
