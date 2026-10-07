# Line Rush

Two buttons. Real beats. Don't miss. The web version of the Roblox rhythm game **Line Rush**, with the same screens, rules, styles, modifiers, progression and layout, plus username/password accounts.

## Play

Lines fall down two lanes. Press **Button 1** (F) and **Button 2** (J), or tap the buttons, as each line crosses the glowing line on the button.

You can see how close each hit was:

- the shaded **hit zone** shows where Perfect, Great and Good count
- the target line lights up as a line arrives
- every hit leaves a short mark where the line actually was (above the button line is early, below is late)
- every hit shows its timing in ms
- pressing just before a line's window shows **TOO EARLY**
- the lane stays lit while you hold the key Hold long lines until their tail passes. Gold lines are chords: hit both. **R** restarts instantly, **Escape** pauses, and leaving the tab pauses too. In song select, the arrow keys pick songs and tabs and **Enter** plays.

- **Tiers:** Easy, Hard, Expert and Extreme tabs, plus **Recent**. Each song has its own chart and a harder **"+"** chart one tier up (Easy → Hard, Hard → Expert, Expert → Extreme, Extreme → Insane).
- **Styles:** Classic, Hardcore (×1.2: tighter timing, no healing, misses hurt more), Sudden Death (×1.3: one miss ends the run), Playground (can't fail, not saved) and Practice (loop a section you choose, not saved).
- **Modifiers:** song speed 0.5–1.5×, Hidden, Sudden, Flashlight, Mirror, Random, Wave, Mines and Autoplay. Each one changes the score multiplier.
- **Progression:**
  - XP and levels, with a daily streak
  - 12 achievements that unlock titles you can wear
  - song packs, with four mastery stars per song (clear / A / S / full combo)
  - personal bests for every chart, and a results screen with a health graph and timing feedback
- **Weekly challenge:** the same song and modifiers for everyone each week. The best score you set that week is shown on the home screen.
- **Settings:**
  - rebind all three keys
  - scroll speed 0.5–3×, audio offset ±300 ms with a tap-along calibration
  - music volume, hit sounds (Tick, Mania, Kick, Clap)
  - effects, the hit zone, and an optional combo in the centre of the playfield
  - **Customize**: Button 1 / Button 2 / chord colors (presets or any color), line style (Glow, Flat, Outline, Classic) and line thickness, with a live preview

Timing windows, health drain and fall speed tighten with each tier:

| Tier | Perfect / Great / Good |
|---|---|
| Easy | ±55/100/150 ms |
| Insane | ±26/48/70 ms |

Perfect, Great and Good score 300/200/100. Combos of 10/25/50 give ×2/×3/×4. Grades: SS is all Perfect; otherwise S ≥95%, A ≥90%, B ≥80%, C ≥70%, D below that, and F if you fail.

Online-only Roblox features don't have a server here yet: the global leaderboards, King of the Hill, the cross-server live feed and 1v1. Those panels say so. The live feed shows your own big plays.

## Accounts

Players can make an account with just a **username and password**. Signing up keeps the progress already made as a guest. Logged-in progress (settings, bests, recent songs, XP, achievements, weekly scores) is saved to the account and follows you to any device. Guests can keep playing without one; their progress stays in the browser.

The **Account** panel (Profile → Account) lets players change their password, log out, log out on every device, or delete their account and its progress.

How it's kept secure (`api/_lib/core.js`):

- **Passwords:**
  - hashed with **scrypt** (N=2¹⁷, r=8, p=1, about 128 MiB per hash) using a random per-user salt, then compared in constant time
  - plain passwords are never stored or logged
  - logging in with a username that doesn't exist costs the same hash, so the response time doesn't reveal which usernames exist
- **Password rules:** 10–128 characters, not containing the username, and not a common password. Usernames are 3–20 letters, numbers or `_`, unique regardless of case; staff-sounding names are reserved.
- **Sessions:**
  - a random 256-bit token in a `__Host-` cookie that is **HttpOnly**, **Secure** and **SameSite=Strict**, so page scripts can't read it and other sites can't send it
  - only a SHA-256 of the token is stored
  - sessions last 30 days
  - changing the password logs out every other device
- **CSRF and origin checks:** every API call must send an `X-LineRush` header, which other sites can't add, and a JSON body. Calls are refused when `Origin` or `Sec-Fetch-Site` show another site.
- **Rate limits:**
  - 20 logins per IP per 15 minutes
  - 8 wrong passwords per account per 15 minutes
  - 5 sign-ups per IP per hour
  - limits on password changes and saves
- **Headers:** a strict Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `nosniff` and `no-referrer` (see `vercel.json`). API responses are never cached.

### Turning accounts on

Accounts are stored in Redis. With no database connected, the game still works and everyone plays as a guest.

**Hosting on Railway (site + database):**

1. **New Project → Deploy from GitHub repo →** pick this repo. Railway runs `npm run build`, then `npm start` (`server.js` serves the game and the account API).
2. In the same project: **+ New → Database → Add Redis**.
3. Open the game service → **Variables → New Variable**: name `REDIS_URL`, value `${{Redis.REDIS_URL}}` (Railway fills in the database's private address).
4. Game service → **Settings → Networking → Generate Domain**.
5. Redeploy. The deploy logs should say `accounts: redis`.

**Site on Vercel, database on Railway:** add a Redis database on Railway, copy its `REDIS_PUBLIC_URL`, and set it as `REDIS_URL` in the Vercel project's environment variables, then redeploy.

**Vercel + Upstash:** in the Vercel project, open **Storage → Marketplace → Upstash (Redis)** and connect it (this sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`), then redeploy. `vercel.json` sends `/api/*` to `api/index.js`.

Any Redis server works the same way: set `REDIS_URL` (`redis://` or `rediss://`).

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

`npm run dev` also serves the account API. Accounts are kept in memory and reset when the dev server restarts, unless `REDIS_URL` (or the Upstash variables) is set. To run the production build locally: `npm run build && npm start`.

```sh
npm test        # charts, scoring, saves, imports and the account server
npm run build
```

## Songs

There are ten original synthesized tracks (five Easy, five Hard), rendered locally with Web Audio. No samples or downloads are needed. The Roblox version's licensed songs can't be used outside Roblox. Use **+ IMPORT** in song select to play your own audio file. It's analysed in the browser, charted from start to finish, and placed in a tier by its tempo. Nothing is uploaded. See [MUSIC-LICENSE.md](MUSIC-LICENSE.md).

Charts are generated from each song's measured low/mid/high onsets on a 16th-note grid:

- kick-heavy hits go to Button 1, snare and hat hits go to Button 2
- note density is tuned per tier
- strong hits become chords or hold notes

Timing runs on the Web Audio clock (`AudioContext.currentTime`) with latency compensation. Input timestamps are corrected for event delay.

## Source

- `src/main.ts`: screens, menus, results, progression, settings, accounts
- `src/game.ts`: gameplay (notes, holds, mines, judging, health, HUD)
- `src/ui.ts`, `src/style.css`, `src/anim.ts`: the UI, laid out like the Roblox ScreenGui (1100×640, scaled to fit)
- `src/config.ts`: tiers, styles, modifiers, packs and achievements
- `src/chart.ts`, `src/tracks.ts`: chart generation
- `src/audio.ts`, `src/synthesis.ts`, `src/custom.ts`: audio, the soundtrack and imports
- `src/scoring.ts`, `src/storage.ts`, `src/weekly.ts`, `src/account.ts`: rules, saves, the weekly challenge and the account client
- `api/`: the account server (Vercel function), with `api/_lib/core.js` and `api/_lib/store.js`
- `scripts/`: offline music generation and analysis
- `tests/`

Code is MIT licensed. The original music recipes and generated audio are dedicated to CC0.
