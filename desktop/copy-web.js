// Copies the website build (../dist, from `npm run build` in the repo root) into web/, which is what
// the app serves and what gets packaged. Run from desktop/ (npm start / npm run dist do it).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../dist', import.meta.url));
const to = fileURLToPath(new URL('./web', import.meta.url));
if (!existsSync(`${from}/index.html`)) {
  console.error('No website build found. Run `npm run build` in the repo root first (or `npm run app` there).');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('copied dist/ -> desktop/web/');
