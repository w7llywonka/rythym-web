// Results: personal bests, XP / streak / packs / achievements, the online leaderboard + weekly
// submission, and the results screen itself (grade, score count-up, breakdown, health graph).
import { api } from '../api.ts';
import { ease, pop, tween } from '../anim.ts';
import { ACHIEVEMENTS, DIFF_XP, MODES, RANK, T } from '../config.ts';
import type { Run } from '../game.ts';
import { formatNumber, gradeColor, gradeFor, keyName, levelFromXp } from '../scoring.ts';
import { $, rgba, show, txt } from '../ui.ts';
import { pushLocalFeed, refreshFeed, refreshHome, refreshWeekly } from './home.ts';
import { retry } from './play.ts';
import { playPreview } from './preview.ts';
import { queueSave } from './save.ts';
import { packProgress, setTab } from './select.ts';
import { game } from './services.ts';
import { escapeHtml, go, onClick, queueToast, setAmbient, signed } from './shell.ts';
import { S, bestKey, packOf, settings } from './state.ts';
import { vsBanner, vsFinal, vsLeaveResults, vsOnResults } from './versus.ts';

/** called by the game when a run ends */
export function finishRun(r: Run, cleared: boolean) {
  game.stop();
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
  const res = await api.submitScore({
    songId: r.track.id, diff: r.chartDiff, score: Math.floor(r.score), grade, fc, title: S.data.profile.title,
    weekly: r.weekly, style: r.set.style, rate: r.set.rate,
  });
  if (!res.ok || !res.data) return txt(label, '');
  const { chart, weekly } = res.data;
  if (weekly?.tookTop) queueToast('You are the new KING OF THE HILL!');
  else if (chart.tookTop) queueToast(`#1 on ${r.track.title}!`);
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
  const fc = cleared && r.counts[3] === 0;
  const key = bestKey(t, r.chartDiff);
  const ranked = !r.unranked;
  const p = S.data.profile;

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
    const today = Math.floor(Date.now() / 86400000);
    if (p.lastDay !== today) {
      p.streak = p.lastDay === today - 1 ? p.streak + 1 : 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.lastDay = today;
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
    const ctx = { cleared, grade, fc, rank: RANK[r.chartDiff], style: r.set.style, rate: r.set.rate, maxCombo: r.maxCombo, packComplete: packDone };
    for (const a of ACHIEVEMENTS) {
      if (!p.achievements[a.id] && a.check(ctx)) {
        p.achievements[a.id] = true;
        queueToast(`ACHIEVEMENT: ${a.name}  (title: ${a.title})`);
      }
    }
  }

  // weekly best (kept locally too) + this browser's feed when there's no server
  if (cleared && ranked) {
    if (r.weekly !== undefined) {
      const wk = String(r.weekly);
      if (!p.weekly[wk] || r.score > p.weekly[wk]) p.weekly[wk] = Math.floor(r.score);
    }
    const who = `<b>${escapeHtml(S.account?.username ?? 'You')}</b>`;
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

export function initResults() {
  onClick('results.panel.retry', () => { vsLeaveResults(); retry(); });
  onClick('results.panel.continue', () => {
    if (S.transitioning) return;
    vsLeaveResults();
    if (S.last.opts?.weekly !== undefined) void go('home', refreshWeekly);
    else void go('select', () => setTab(S.tab, true));
  });
}
