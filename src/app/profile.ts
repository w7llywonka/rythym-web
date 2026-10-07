// Profile: lifetime stats and achievements (click an unlocked one to wear its title).
import { ACHIEVEMENTS, T } from '../config.ts';
import { formatNumber, levelFromXp } from '../scoring.ts';
import { $, rgba, txt } from '../ui.ts';
import { openAccount, openAuth } from './accounts.ts';
import { refreshHome } from './home.ts';
import { queueSave } from './save.ts';
import { closeModal, onClick, openModal, showToast } from './shell.ts';
import { S } from './state.ts';

function refresh() {
  const p = S.data.profile;
  txt($('profile.stats.level.value'), String(levelFromXp(p.xp).level));
  txt($('profile.stats.plays.value'), formatNumber(p.plays));
  txt($('profile.stats.noteshit.value'), formatNumber(p.notesHit));
  txt($('profile.stats.fullcombos.value'), formatNumber(p.fcs));
  txt($('profile.stats.ssranks.value'), formatNumber(p.ss));
  txt($('profile.stats.playtime.value'), `${Math.floor(p.playSeconds / 3600)}h ${Math.floor((p.playSeconds % 3600) / 60)}m`);
  txt($('profile.ptitle'), p.title ? p.title.toUpperCase() : '');
  txt($('profile.account'), S.account ? 'ACCOUNT' : 'LOG IN');
  ACHIEVEMENTS.forEach((a, i) => {
    const id = `profile.achievements.ach${i + 1}`;
    const unlocked = p.achievements[a.id] === true;
    const wearing = unlocked && p.title === a.title;
    txt($(`${id}.name`), a.name);
    txt($(`${id}.desc`), `${a.desc}\nTitle: ${a.title}`);
    txt($(`${id}.state`), wearing ? 'WEARING' : unlocked ? 'UNLOCKED' : 'LOCKED');
    $(`${id}.state`).style.color = wearing ? T.gold : unlocked ? T.green : T.dim;
    $(`${id}.name`).style.color = unlocked ? T.text : T.dim;
    $(id).style.backgroundColor = unlocked ? T.bg2 : T.bg1;
    $(id).style.boxShadow = `0 0 0 1px ${wearing ? rgba(T.gold, 0.6) : T.line}`;
    $(id).style.opacity = unlocked ? '1' : '0.6';
  });
}

function openProfile() {
  refresh();
  openModal($('profile'));
}

export function initProfile() {
  ACHIEVEMENTS.forEach((a, i) => onClick(`profile.achievements.ach${i + 1}`, () => {
    if (!S.data.profile.achievements[a.id]) return;
    S.data.profile.title = S.data.profile.title === a.title ? '' : a.title;
    refresh();
    refreshHome();
    queueSave();
  }));
  onClick('profile.close', closeModal);
  onClick('home.profile', openProfile);
  onClick('profile.account', () => {
    if (S.account) openAccount();
    else if (S.accountsOffline) showToast("Accounts aren't available on this server. Your progress is saved in this browser.");
    else openAuth();
  });
}
