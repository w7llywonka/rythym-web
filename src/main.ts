// LINE RUSH (web). Screens: Home -> Select -> Game -> Results, plus the Pause / Settings / Customize /
// Style / Calibrate / Leaderboard / Profile / 1v1 / Account panels. Each lives in src/app/.
import './style.css';
import { initAccounts, restoreSession } from './app/accounts.ts';
import { initBoard } from './app/board.ts';
import { initCalibration } from './app/calibration.ts';
import { initCredits } from './app/credits.ts';
import { initCustomize } from './app/customize.ts';
import { initHome } from './app/home.ts';
import { initKeyboard } from './app/keyboard.ts';
import { startLoop } from './app/loop.ts';
import { initPlay } from './app/play.ts';
import { initPreview, showNowPlaying } from './app/preview.ts';
import { initProfile } from './app/profile.ts';
import { initResults } from './app/results.ts';
import { initSave } from './app/save.ts';
import { initSelect, setTab } from './app/select.ts';
import { initSettings, refreshSettings } from './app/settingsPanel.ts';
import { showScreen } from './app/shell.ts';
import { S } from './app/state.ts';
import { initStylePanel } from './app/stylePanel.ts';
import { initVersus } from './app/versus.ts';
import { $, buildUI, fitStage } from './ui.ts';

buildUI(document.getElementById('app')!);
fitStage();
window.addEventListener('resize', fitStage);

initSave();
initSelect();
initStylePanel();
initBoard();
initProfile();
initPlay();
initResults();
initVersus();
initCalibration();
initSettings();
initCustomize();
initAccounts();
initHome();
initCredits();
initKeyboard();
initPreview();

showScreen('home');
setTab('Easy', true);
refreshSettings();
S.previewTrack = S.selectedSong.Easy ?? null;
if (S.previewTrack) showNowPlaying(S.previewTrack);

// fade in from black
const fader = $('fader');
fader.style.opacity = '1';
requestAnimationFrame(() => {
  fader.style.transition = 'opacity .6s';
  fader.style.opacity = '0';
});
startLoop();
void restoreSession();
