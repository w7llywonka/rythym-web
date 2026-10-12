// Results: personal bests, XP / streak / packs / achievements, the online leaderboard + weekly
// submission, and the results screen itself (grade, score count-up, breakdown, health graph), plus
// what the run unlocked (toasts, and a button to the Locker).
import { api } from '../api.ts';
import { ease, pop, tween } from '../anim.ts';
import { ACHIEVEMENTS, DIFF_XP, MODES, RANK, T } from '../config.ts';
import type { Run } from '../game.ts';
import { formatNumber, gradeColor, gradeFor, keyName, levelFromXp } from '../scoring.ts';
import { $, button, label, rgba, show, txt } from '../ui.ts';
import { pushLocalFeed, refreshFeed, refreshHome, refreshWeekly } from './home.ts';
import { openLocker } from './locker.ts';
import { UNLOCK_NOUN, unlockParts, unlockSummary } from './lockerView.ts';
import { nameplateHtml } from './nameplate.ts';
import { retry } from './play.ts';
import { playPreview } from './preview.ts';
import { queueSave } from './save.ts';
import { packProgress, setTab } from './select.ts';
import { game } from './services.ts';
import { escapeHtml, go, onClick, queueToast, setAmbient, signed } from './shell.ts';
import { S, bestKey, packOf, settings } from './state.ts';
import { finishTutorial } from './tutorial.ts';
import { allUnlockables, announceNewUnlocks, lookForServer, today, unlockedKeys, type Unlockable } from './unlocks.ts';
import { vsBanner, vsFinal, vsLeaveResults, vsOnResults } from './versus.ts';

/** called by the game when a run ends */
export function finishRun(r: Run, cleared: boolean) {
  game.stop();
  // the tutorial has its own end screen, and nothing from it counts (no bests, XP or stats)
  if (r.opts?.tutorial) return finishTutorial(r);
  if (r.opts?.versus) vsFinal(r, cleared);
  void showResults(r, cleared);
}

function buildGraph(r: Run) {
  const bars = $('results.panel.graph.bars');
  bars.innerHTML = '';
  const samples = r.samples;
  if (!samples.length) return;
  const n = Math.min(samples.length, 140);
  const per = samples.length / n;
  const missAt = new Set<number>();
  for (const idx of r.missMarks) missAt.add(Math.min(n, Math.max(1, Math.floor((idx - 1) / per) + 1)));
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= n; i++) {
    const a = Math.floor((i - 1) * per), b = Math.max(Math.floor(i * per), a + 1);
    let sum = 0, c = 0;
    for (let k = a; k < Math.min(b, samples.length); k++) { sum += samples[k]; c++; }
    const hp = c ? sum / c / 100 : 0;
    const bar = document.createElement('div');
    bar.className = 'gbar';
    bar.style.left = `${((i - 1) / n) * 100}%`;
    bar.style.width = `calc(${100 / n}% - 1px)`;
    bar.style.height = `${Math.max(hp, 0.04) * 100}%`;
    const miss = missAt.has(i);
    bar.style.background = rgba(miss ? T.red : hp > 0.5 ? T.green : hp > 0.25 ? T.gold : T.red, miss ? 0 : 0.4);
    frag.appendChild(bar);
  }
  bars.appendChild(frag);
}

/** online leaderboard + weekly board (logged in, ranked, built-in song) */
async function submitOnline(r: Run, grade: string, fc: boolean) {
  const label = $('results.panel.rank');
  if (S.accountsOffline || r.track.custom) return txt(label, '');
  if (!S.account) return txt(label, 'LOG IN TO JOIN THE LEADERBOARD');
  txt(label, '');
  const look = lookForServer();
  const res = await api.submitScore({
    songId: r.track.id, diff: r.chartDiff, score: Math.floor(r.score), grade, fc, title: look.title ?? '', tag: look.tag, color: look.color,
    weekly: r.weekly, style: r.set.style, rate: r.set.rate,
  });
  if (!res.ok || !res.data) return txt(label, '');
  const { chart, weekly } = res.data;
  if (weekly?.tookTop) queueToast('You are the new KING OF THE HILL!');
  else if (chart.tookTop) queueToast(`#1 on ${r.track.title}!`);
  // taking #1 / the crown counts toward the #1, KING and Royal unlocks
  if (weekly?.tookTop || chart.tookTop) {
    const p = S.data.profile, before = unlockedKeys();
    if (weekly?.tookTop) p.kings++;
    if (chart.tookTop) p.tops++;
    queueSave();
    announceNewUnlocks(before);
    addUnlocks(before);
    refreshHome();
  }
  const parts = [];
  if (chart.rank) parts.push(`#${chart.rank} WORLDWIDE${chart.improved ? '' : `  (best ${formatNumber(chart.best)})`}`);
  if (weekly?.rank) parts.push(`#${weekly.rank} THIS WEEK`);
  if (S.screen === 'results') txt(label, parts.join('  ·  '));
  void refreshFeed();
  if (weekly) refreshWeekly();
}

async function showResults(r: Run, cleared: boolean) {
  const t = r.track;
  const acc = game.accuracyOf(r);
  const grade = gradeFor(acc, cleared, r.counts);
  S.lastResult = { title: t.title, diff: r.chartDiff, grade, accuracy: acc };
  const fc = cleared && r.counts[3] === 0;
  const key = bestKey(t, r.chartDiff);
  const ranked = !r.unranked;
  const p = S.data.profile;
  const before = unlockedKeys();
  shownUnlocks = [];

  // personal best
  const old = S.data.bests[key];
  const isBest = cleared && ranked && (!old || r.score > old.score);
  if (cleared && ranked) {
    if (isBest) S.data.bests[key] = { score: Math.floor(r.score), accuracy: acc, combo: r.maxCombo, grade, fc: fc || !!old?.fc };
    else if (fc && old && !old.fc) old.fc = true;
  }

  // profile: xp, stats, streak
  let xpGained = 0;
  const levelBefore = levelFromXp(p.xp).level;
  if (!r.auto) {
    const hits = r.counts[0] + r.counts[1] + r.counts[2];
    xpGained = Math.floor(hits * (0.5 + acc / 200) * DIFF_XP[r.chartDiff] * (cleared ? 1 : 0.4) * (ranked ? 1 : 0.25));
    p.xp += xpGained;
    p.plays++;
    p.notesHit += hits;
    p.playSeconds += Math.floor((performance.now() - r.playStart) / 1000);
    if (ranked && fc) p.fcs++;
    if (ranked && grade === 'SS') p.ss++;
    const day = today();
    if (!p.since) p.since = day;
    if (p.lastDay !== day) {
      p.streak = p.lastDay === day - 1 ? p.streak + 1 : 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.lastDay = day;
    }
  }
  const levelAfter = levelFromXp(p.xp).level;
  if (levelAfter > levelBefore) queueToast(`LEVEL UP!  You're now level ${levelAfter}`);

  // song packs + achievements (ranked runs only)
  let packDone = false;
  if (ranked && cleared) {
    const pack = packOf.get(t.id);
    if (pack && !p.packs[pack.id] && packProgress(pack).cleared >= packProgress(pack).total) {
      p.packs[pack.id] = true;
      packDone = true;
      queueToast(`${pack.name} COMPLETE!`);
    }
  }
  if (ranked) {
    const ctx = {
      cleared, grade, fc, rank: RANK[r.chartDiff], style: r.set.style, rate: r.set.rate, maxCombo: r.maxCombo, packComplete: packDone,
      accuracy: acc, set: r.set, weekly: r.weekly !== undefined, custom: !!t.custom,
    };
    for (const a of ACHIEVEMENTS) {
      if (!p.achievements[a.id] && a.check(ctx)) {
        p.achievements[a.id] = true;
        queueToast(`ACHIEVEMENT: ${a.name}  (title: ${a.title})`);
      }
    }
  }
  announceNewUnlocks(before);

  // weekly best (kept locally too) + this browser's feed when there's no server
  if (cleared && ranked) {
    if (r.weekly !== undefined) {
      const wk = String(r.weekly);
      if (!p.weekly[wk] || r.score > p.weekly[wk]) p.weekly[wk] = Math.floor(r.score);
    }
    const who = nameplateHtml(S.account?.username ?? 'You', lookForServer());
    const what = `${escapeHtml(t.title)} [${MODES[r.chartDiff].label}]`;
    if (grade === 'SS' && RANK[r.chartDiff] >= 2) pushLocalFeed(`${who} got an SS on ${what}`);
    else if (fc && RANK[r.chartDiff] >= 3) pushLocalFeed(`${who} full-comboed ${what}`);
    else if (isBest) pushLocalFeed(`${who} set a new best on ${what}`);
  }
  queueSave();
  refreshHome();

  await go('results', () => {
    const mode = MODES[r.chartDiff];
    pop($('results.panel'), 0.94, 0.35, ease.back);
    const gc = gradeColor(grade, T);
    setAmbient(gc, cleared ? t.color1 : T.red);
    const g = $('results.panel.circle.grade');
    txt(g, grade);
    g.style.color = gc;
    g.style.fontSize = grade.length > 1 ? '110px' : '140px';
    $('results.panel.circle').style.boxShadow = `0 0 0 3px ${gc}, 0 0 60px ${rgba(gc, 0.85)}`;
    $('results.panel.circle').style.setProperty('--s', '0.4');
    setTimeout(() => pop($('results.panel.circle'), 0.4, 0.5, ease.back), 250);
    const [status, statusColor] = !cleared ? ['FAILED', T.red] : grade === 'SS' ? ['ALL PERFECT', T.gold] : fc ? ['FULL COMBO', T.gold] : ['CLEARED', T.green];
    txt($('results.panel.status'), status);
    $('results.panel.status').style.color = statusColor;
    show($('results.panel.newbest'), isBest);
    txt($('results.panel.title'), t.title);
    txt($('results.panel.info'), `${mode.label}  ·  ${r.summary}  ·  LV ${t.charts[r.chartDiff]!.level}`);
    txt($('results.panel.xp'), xpGained > 0 ? `+${formatNumber(xpGained)} XP  ·  LV ${levelAfter}` : '');
    txt($('results.panel.rank'), '');
    addUnlocks(before);
    vsOnResults(!!r.opts?.versus);
    vsBanner();
    const score = Math.floor(r.score);
    tween($('results.panel.score'), 'count', 0, score, 1.1, v => txt($('results.panel.score'), formatNumber(v)), ease.quart);
    txt($('results.panel.accuracy.value'), `${acc.toFixed(2)}%`);
    txt($('results.panel.maxcombo.value'), `${r.maxCombo} / ${r.objects}`);
    const total = Math.max(1, r.objects);
    (['perfect', 'great', 'good', 'miss'] as const).forEach((nm, i) => {
      txt($(`results.panel.breakdown.${nm}.value`), String(r.counts[i]));
      const fill = $(`results.panel.breakdown.${nm}.bar.fill`);
      fill.style.width = '0%';
      setTimeout(() => { fill.style.width = `${Math.min(1, r.counts[i] / total) * 100}%`; }, 200 + i * 80);
    });
    buildGraph(r);
    // timing feedback (and a hint for the audio offset setting)
    const avg = game.averageError(r);
    let avgText = '';
    if (r.unranked) avgText = 'Unranked run, score not saved';
    else if (avg !== null && r.errors.length >= 10) {
      const ms = Math.round(Math.abs(avg) * 1000);
      if (ms <= 12) avgText = `Avg timing ${ms}ms ${avg < 0 ? 'early' : 'late'}: right on the beat`;
      else {
        const suggest = Math.min(300, Math.max(-300, settings().offset + (avg < 0 ? -1 : 1) * Math.round(ms / 5) * 5));
        avgText = `You hit ${ms}ms ${avg < 0 ? 'early' : 'late'} on average. Try audio offset ${signed(suggest)} ms`;
      }
    }
    txt($('results.panel.avg'), avgText);
    txt($('results.panel.retry'), `RETRY  (${keyName(settings().keys[2])})`);
  });
  if (cleared && ranked && !r.auto && !r.practice) void submitOnline(r, grade, fc);
  void playPreview(t);
}

// ---- what this run unlocked: a button to the Locker, bottom left -------------------------------
let shownUnlocks: Unlockable[] = [];

/** one unlock in words: tags as their badge, name colors in their color */
function unlockPiece(u: Unlockable): Node {
  const el = document.createElement('span');
  const name = document.createElement('span');
  name.textContent = u.label;
  if (u.category === 'tag') {
    name.className = 'np-tag';
    name.style.setProperty('--tc', u.color ?? T.text);
  } else if (u.category === 'color') {
    if (u.gradient) { name.className = 'np-grad'; name.style.backgroundImage = u.gradient; } else name.style.color = u.color ?? T.text;
  }
  el.append(name, ` ${UNLOCK_NOUN[u.category]}`);
  return el;
}

/** adds what's been unlocked since `before` to the button (titles too: they're new in the Locker); also for a 1v1 win that's settled after the screen is up */
export function addUnlocks(before: Set<string>) {
  const after = unlockedKeys();
  for (const u of allUnlockables()) if (after.has(u.key) && !before.has(u.key) && !shownUnlocks.includes(u)) shownUnlocks.push(u);
  const btn = $('results.panel.unlocks');
  show(btn, shownUnlocks.length > 0 && S.screen === 'results');
  if (!shownUnlocks.length) return;
  txt($('results.panel.unlocks.head'), shownUnlocks.length === 1 ? 'NEW IN YOUR LOCKER' : `${shownUnlocks.length} NEW IN YOUR LOCKER`);
  const what = $('results.panel.unlocks.what');
  (what.querySelector('.tx') ?? what).replaceChildren(...unlockParts(shownUnlocks).map(p => (typeof p === 'string' ? p : unlockPiece(p))));
  what.title = unlockSummary(shownUnlocks, 99);
  btn.classList.remove('lk-arrive');
  void btn.offsetWidth;
  btn.classList.add('lk-arrive');
}

export function initResults() {
  const ub = button($('results.panel'), 'unlocks', { text: '', x: 40, y: 538, w: 320, h: 56, r: 16, hidden: true, cls: 'lk-resbtn' });
  label(ub, 'head', { text: 'NEW IN YOUR LOCKER', font: 'black', size: 10, color: T.pink, x: 18, y: 11, w: 220, h: 14 });
  label(ub, 'what', { text: '', font: 'bold', size: 13, truncate: true, x: 18, y: 28, w: 226, h: 18 });
  label(ub, 'open', { text: 'OPEN  →', font: 'black', size: 11, align: 'right', ax: 1, x: [1, -16], y: 0, w: 66, h: 56 });
  onClick('results.panel.unlocks', () => openLocker(shownUnlocks[0]?.category));
  onClick('results.panel.retry', () => { vsLeaveResults(); retry(); });
  onClick('results.panel.continue', () => {
    if (S.transitioning) return;
    vsLeaveResults();
    if (S.last.opts?.weekly !== undefined) void go('home', refreshWeekly);
    else void go('select', () => setTab(S.tab, true));
  });
}
