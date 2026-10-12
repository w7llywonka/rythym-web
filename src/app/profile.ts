// Profile: your nameplate and title, lifetime stats, the Locker, and achievements (click an unlocked
// one to wear its title).
import { ACHIEVEMENTS, T } from '../config.ts';
import { formatNumber, levelFromXp } from '../scoring.ts';
import { $, rgba, txt } from '../ui.ts';
import { openAccount, openAuth } from './accounts.ts';
import { refreshHome } from './home.ts';
import { openLocker, refreshLockerBadges, syncLook } from './locker.ts';
import { renderNameplate } from './nameplate.ts';
import { queueSave } from './save.ts';
import { closeModal, onClick, openModal, showToast } from './shell.ts';
import { S } from './state.ts';
import { lookForServer } from './unlocks.ts';

/** big counts stay inside their box: 1,234,567 -> 1.2M */
function compact(n: number): string {
  if (n >= 1e6) return `${(Math.floor(n / 1e5) / 10).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e5) return `${Math.floor(n / 1e3)}K`;
  return formatNumber(n);
}

const dayText = (day: number) => new Date(day * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function refresh() {
  const p = S.data.profile;
  renderNameplate($('profile.me.name'), S.account?.username ?? 'Guest', lookForServer());
  const title = $('profile.me.title');
  txt(title, p.title ? p.title.toUpperCase() : 'NO TITLE YET');
  title.style.color = p.title ? T.gold : T.dim;
  txt($('profile.me.since'), p.since ? `Playing since ${dayText(p.since)}` : p.plays > 0 ? 'Playing since the early days' : 'Play a song to start your story');
  const streak = p.bestStreak > 0 ? `Best streak ${p.bestStreak} day${p.bestStreak === 1 ? '' : 's'}` : '';
  // wins of battles played (a draw is neither, so there's no loss count)
  const vs = p.vsPlays > 0 ? `1v1 ${p.vsWins} win${p.vsWins === 1 ? '' : 's'} of ${p.vsPlays}` : '';
  txt($('profile.me.more'), [streak, vs].filter(Boolean).join('  ·  '));
  txt($('profile.stats.level.value'), String(levelFromXp(p.xp).level));
  txt($('profile.stats.plays.value'), compact(p.plays));
  txt($('profile.stats.noteshit.value'), compact(p.notesHit));
  txt($('profile.stats.fullcombos.value'), compact(p.fcs));
  txt($('profile.stats.ssranks.value'), compact(p.ss));
  txt($('profile.stats.playtime.value'), `${Math.floor(p.playSeconds / 3600)}h ${Math.floor((p.playSeconds % 3600) / 60)}m`);
  txt($('profile.account'), S.account ? 'ACCOUNT' : 'LOG IN');
  const earned = ACHIEVEMENTS.filter(a => p.achievements[a.id]).length;
  txt($('profile.achheader'), `ACHIEVEMENTS  ${earned} / ${ACHIEVEMENTS.length}`);
  ACHIEVEMENTS.forEach((a, i) => {
    const id = `profile.achievements.ach${i + 1}`;
    const unlocked = p.achievements[a.id] === true;
    const wearing = unlocked && p.title === a.title;
    txt($(`${id}.name`), a.name);
    txt($(`${id}.desc`), `${a.desc}\nTitle: ${a.title}`);
    txt($(`${id}.state`), wearing ? '✓ WEARING' : unlocked ? 'UNLOCKED' : 'LOCKED');
    $(`${id}.state`).style.color = wearing ? T.gold : unlocked ? T.green : T.dim;
    $(`${id}.name`).style.color = unlocked ? T.text : T.dim;
    $(id).style.backgroundColor = unlocked ? T.bg2 : T.bg1;
    $(id).style.boxShadow = `0 0 0 1px ${wearing ? rgba(T.gold, 0.4) : T.line}${wearing ? `, 0 0 24px -8px ${rgba(T.gold, 0.5)}` : ''}`;
    $(id).style.opacity = unlocked ? '1' : '0.6';
    $(id).style.cursor = unlocked ? 'pointer' : 'default';
  });
  refreshLockerBadges();
  fitName();
}

/**
 * your whole name shows, tag and all: the name takes the room 'since' leaves on its line, then the
 * font steps down to 16 px (it measures, so the panel has to be showing)
 */
function fitName() {
  const name = $('profile.me.name'), since = $('profile.me.since').querySelector('.tx') as HTMLElement;
  name.style.width = `${Math.max(380, $('profile.me').offsetWidth - 36 - 16 - since.offsetWidth)}px`;
  const text = name.querySelector('.np-name') as HTMLElement;
  for (let size = 24; size >= 16; size -= 2) {
    name.style.fontSize = `${size}px`;
    if (text.scrollWidth <= text.clientWidth) break;
  }
}

export function openProfile() {
  openModal($('profile'));
  refresh();
}

export function initProfile() {
  ACHIEVEMENTS.forEach((a, i) => onClick(`profile.achievements.ach${i + 1}`, () => {
    if (!S.data.profile.achievements[a.id]) return;
    S.data.profile.title = S.data.profile.title === a.title ? '' : a.title;
    refresh();
    refreshHome();
    queueSave();
    syncLook();
  }));
  onClick('profile.close', closeModal);
  onClick('home.profile', openProfile);
  onClick('profile.locker', () => openLocker(undefined, openProfile));
  onClick('profile.account', () => {
    if (S.account) openAccount();
    else if (S.accountsOffline) showToast("Accounts aren't available on this server. Your progress is saved in this browser.");
    else openAuth();
  });
}
