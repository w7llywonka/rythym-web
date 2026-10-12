// The installers' packaging (desktop/package.json "build" and desktop/build/): the art is where electron-builder
// looks for it and at the size NSIS / Finder / Linux desktops expect, the license page reads right, and nothing
// here can get in the way of the app updating itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../desktop/', import.meta.url));
const build = JSON.parse(readFileSync(`${desktop}package.json`, 'utf8')).build;
const file = (path: string) => readFileSync(`${desktop}${path}`);

function bmpInfo(b: Buffer) {
  assert.equal(b.toString('latin1', 0, 2), 'BM');
  return { w: b.readInt32LE(18), h: Math.abs(b.readInt32LE(22)), bits: b.readUInt16LE(28), compression: b.readUInt32LE(30) };
}
function pngSize(b: Buffer) {
  assert.equal(b.toString('latin1', 1, 4), 'PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const words = (s: string) => s.replace(/\s+/g, ' ').trim();

test('Windows installer: its pictures are there, uncompressed 24-bit BMPs at the size NSIS shows', () => {
  const sizes: [string, number, number][] = [['installerSidebar', 164, 314], ['uninstallerSidebar', 164, 314], ['installerHeader', 150, 57]];
  for (const [key, w, h] of sizes) {
    assert.deepEqual(bmpInfo(file(build.nsis[key])), { w, h, bits: 24, compression: 0 }, key);
  }
});

test('Windows installer: assisted and per user as before, so installs and updates find each other', () => {
  const { nsis } = build;
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.artifactName, 'Line-Rush-Setup-${version}.${ext}');
  assert.equal(nsis.guid, undefined); // a new GUID would install a second copy instead of updating
  assert.equal(nsis.deleteAppDataOnUninstall, false); // the uninstaller promises your scores stay
  assert.equal(build.appId, 'com.linerush.game');
  assert.deepEqual(build.publish.map((p: { provider: string; owner: string; repo: string }) => [p.provider, p.owner, p.repo]), [['github', 'w7llywonka', 'rythym-web']]);
  assert.match(build.copyright, /^Copyright © \d{4} Line Rush$/);
});

test('installer.nsh: uses electron-builder\'s hooks and never waits for a click during a silent update', () => {
  const nsh = file(build.nsis.include).toString('utf8');
  for (const hook of ['customInit', 'customWelcomePage', 'customPageAfterChangeDir', 'customInstall', 'customFinishPage',
    'customUnInit', 'customUnWelcomePage', 'customUnInstall', 'customUninstallPage']) {
    assert.match(nsh, new RegExp(`^!macro ${hook}$`, 'm'), hook);
  }
  // a message box in a silent install needs its answer given (/SD), or the update hangs
  for (const line of nsh.split('\n').filter(l => /^\s*MessageBox/i.test(l))) assert.match(line, /\/SD /, line);
  // the finish page starts the game like electron-builder's own: as the player, with --updated after an update
  assert.match(nsh, /StdUtils\.ExecShellAsUser\} \$0 "\$launchLink" "open" "\$1"/);
});

test('license page: plain ASCII (NSIS shows other text wrong without a BOM), the MIT terms word for word', () => {
  const text = file(build.nsis.license).toString('latin1');
  assert.match(text, /^[\n\r\x20-\x7E]*$/);
  const mit = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.ok(words(text).includes(words(mit.slice(mit.indexOf('Permission is hereby granted')))));
  assert.match(text, /CC0 1\.0/);
  assert.match(text, /CC BY 4\.0/);
});

test('nothing in desktop/build becomes a click-through EULA in the Linux AppImage', () => {
  // electron-builder shows build/license.txt (or eula.txt / .html) on the AppImage's first launch
  const names = readdirSync(`${desktop}build`).map(n => n.toLowerCase());
  for (const n of ['license.txt', 'license.html', 'eula.txt', 'eula.html']) assert.ok(!names.includes(n), n);
});

test('macOS dmg: Retina background pair, both icons inside the window', () => {
  const { dmg } = build;
  assert.deepEqual(pngSize(file(dmg.background)), { w: 540, h: 380 });
  assert.deepEqual(pngSize(file(dmg.background.replace(/\.png$/, '@2x.png'))), { w: 1080, h: 760 });
  assert.deepEqual(dmg.window, { width: 540, height: 380 });
  for (const c of dmg.contents) {
    assert.ok(c.x - dmg.iconSize / 2 > 0 && c.x + dmg.iconSize / 2 < 540 && c.y - dmg.iconSize / 2 > 0 && c.y + dmg.iconSize / 2 < 380);
  }
  assert.ok(dmg.contents.some((c: { type: string; path?: string }) => c.type === 'link' && c.path === '/Applications'));
});

test('Linux: icons at the sizes desktops look up, a Games entry', () => {
  const dir = `${desktop}${build.linux.icon}`;
  for (const n of [16, 32, 48, 64, 128, 256, 512]) {
    assert.ok(existsSync(`${dir}/${n}x${n}.png`), `${n}x${n}`);
    assert.deepEqual(pngSize(readFileSync(`${dir}/${n}x${n}.png`)), { w: n, h: n });
  }
  assert.match(build.linux.category, /^Game\b/);
  assert.equal(build.deb.packageCategory, 'games');
  assert.equal(build.linux.desktop.entry.StartupWMClass, 'line-rush'); // matches desktopName, so the window groups with its icon
});
