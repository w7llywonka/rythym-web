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

**1v1** (needs an account): open 1V1 on the home screen to see who's online and challenge them on the song you have selected. They get a pop-up for 20 seconds, and the song downloads while it's up (ACCEPT shows LOADING… until it's ready; if it can't load, the challenge is declined). Once accepted, you both start the same chart at the same server moment, see each other's live score, combo and health, and can send reactions with keys 1–4 (🔥 😂 😤 GG). No pausing; leaving counts as a forfeit, and so does a battle whose song can't load in time. Highest score wins.

**Online** (needs the server; anyone can view, an account is needed to post):
- **Leaderboards**: every built-in chart has a global top 10 (TOP 10 on the song panel) with your own best and rank. Finishing a ranked run posts your score; the results screen shows your worldwide rank. Scores above what the chart allows are rejected.
- **King of the Hill**: the weekly challenge has its own board; #1 is the King, shown on the home screen.
- **Live feed**: new #1s, SS ranks, full combos on Expert+ and new Kings show up for everyone on the home screen.

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

## Desktop app

Line Rush also comes as an app for **Windows, macOS and Linux** (`desktop/`, Electron). It's the same game and the same accounts, plus:

- **Fullscreen** with F11 or Alt+Enter, where Escape still pauses (in a browser, Escape kicks you out of fullscreen)
- **Unlocked frame rate**: turns off V-Sync for less lag between your key press and the screen
- **Discord status**: shows the song, tier and time left on your Discord profile
- **Songs folder** (`Documents/Line Rush/Songs`): drop audio files in and they're imported when you open song select
- **Screenshots** with F12 (saved to `Pictures/Line Rush`)
- starts instantly and **plays offline** (the game and songs are inside the app), and the menu music starts without a click
- your save is written before the window closes, the screen doesn't sleep during a song, and the game keeps running in the background (1v1)
- your login is kept by the app and encrypted with the system keychain; the game page itself never sees it
- **automatic updates** from GitHub Releases (Windows and Linux; macOS shows a download link)

Everything app-only is under **APP** on the home screen. On the website that button is **GET THE APP**.

```sh
npm run app        # build the game and open it in the app (first: npm --prefix desktop install)
npm run app:dist   # make an installer for this computer in desktop/release/
```

**Releases:** `.github/workflows/desktop.yml` builds the Windows installer, the macOS dmg and the Linux AppImage / deb. Bump `version` in `desktop/package.json`, then push a matching tag (`git tag v1.0.1 && git push --tags`), and the installers are published to a GitHub Release that installed apps update from. Run the workflow by hand to just get the installers as downloads. macOS builds aren't code-signed, so the first launch needs right-click → Open.

**Settings for a build** (repository variables, or `desktop/app-config.json`):
- `LINE_RUSH_SERVER`: the address of your online server (e.g. your Railway domain). Without it the app plays offline as a guest; players can also enter a server under APP.
- `DISCORD_CLIENT_ID`: create an application at discord.com/developers (name it "Line Rush", and add the icon as a Rich Presence art asset called `logo`), then put its Application ID here.

## Songs

- **Ten originals** (five Easy, five Hard): synthesized locally with Web Audio, CC0.
- **Nine licensed tracks** (four Expert, five Extreme) by other artists, all CC0 or CC BY 4.0, each checked on its source page (no NonCommercial / NoDerivatives / ShareAlike licenses, remixes or re-uploads). They're credited in the game (CREDITS on the home screen, and the license on each song panel) and in [MUSIC-LICENSE.md](MUSIC-LICENSE.md). Expert songs play in full; Extreme songs are a one-minute excerpt of their busiest part, like the Roblox version. To add one: put it in `scripts/licensed-tracks.json`, run `npm run tracks -- --from <folder with the downloads>` (makes `public/music/<id>.mp3` and its analysis), then `npm run charts`.
- The Roblox version's licensed songs can't be used outside Roblox.

Use **+ IMPORT** in song select to play your own audio file. Everything happens in your browser, and nothing is uploaded: the song is kept on your computer (IndexedDB) so it's still there next time, and its scores stay on your computer too, never in your account. **REMOVE IMPORT** on its song panel deletes it.

The import beatmapper:

- **Beat tracking** (dynamic programming over the onset signal) follows the song's real beats, including tempo drift, instead of assuming one perfect tempo. Tempo is chosen from several candidates by how well each one's 16th grid explains the onsets, so half / double time and triplet hi-hats don't fool it. Fast breakbeat, DnB and hardcore that fit the half tempo just as well are caught too (strong off-beats and busy 16ths mean it's really double), so a 170 BPM jungle track isn't charted as an 85 BPM Easy song.
- **Onsets** are picked per band (kick, body, presence, air) and each lands on exactly one 16th step. Only clear hits become lines.
- **Vocals** get their own layer. Lead vocals sit in the centre of a stereo mix and don't repeat bar for bar the way the backing does, so the beatmapper takes the centre of the mix (120 Hz–4 kHz), removes what repeats every bar (REPET on the beat grid: loops, drum patterns, chord cycles) and what's percussive (median filtering), then finds where sung syllables and notes start (SuperFlux, so vibrato isn't a new note). Each one gets a pitch and how long it's held.
- **Harder charts follow the voice more.** Easy and Hard stay mostly on the beat. From Expert up, clear sung syllables win over hi-hats, and on Extreme and Insane hi-hat-only steps give way to the voice while it's singing. Sung lines move with the melody (pitch going up → Button 2, down → Button 1, a repeated note stays put), and long sung notes become holds.
- **Holds** come from sounds that actually ring out (808s, sung or synth notes), followed by pitch so drums on top don't cut them off.
- **Density follows the song's energy** (drops are busier than breakdowns), and **repeating bars get repeating patterns**, like a hand-made chart.
- The whole song is charted, and it lands in a tier by its tempo.

On real songs this puts roughly 85–90% of lines exactly on a real onset (within 30 ms). For vocals it was measured on a cappellas mixed over beats (where every syllable's real time is known). Compared with charting from the drum bands alone, Extreme charts land on about twice as many sung syllables beyond chance, and on more real drum hits too. Imports from before the vocal layer are charted again automatically, in the background between songs. See [MUSIC-LICENSE.md](MUSIC-LICENSE.md).

Charts are generated from each song's measured low/mid/high onsets on a 16th-note grid:

- kick-heavy hits go to Button 1, snare and hat hits go to Button 2 (sung lines follow their melody)
- note density is tuned per tier
- strong hits become chords or hold notes

Timing runs on the Web Audio clock (`AudioContext.currentTime`) with latency compensation. Input timestamps are corrected for event delay.

## Source

- `src/main.ts`: startup (builds the UI, wires every screen, restores the session)
- `src/app/`: one module per screen or panel, sharing `state.ts`
  - `home` · `select` (song list + imports) · `play` (start / pause / quit) · `results` · `board` (leaderboards) · `versus` (1v1, with `vsPrep`: getting the song ready in time) · `profile` · `stylePanel` · `settingsPanel` · `customize` · `calibration` · `accounts`
  - `shell` (screens, panels, toasts) · `save` · `preview` (menu music) · `keyboard` · `loop` (frame loop) · `services` (audio + game engines)
- `src/game.ts`: gameplay (notes, holds, mines, judging, health, HUD)
- `src/ui.ts`, `src/style.css`, `src/anim.ts`, `src/look.ts`: the interface, laid out like the Roblox ScreenGui (1100×640, scaled to fit), and how the lines look
- `src/chart.ts`, `src/tracks.ts`, `src/custom.ts`: chart generation and the import beatmapper
- `src/audio.ts`, `src/synthesis.ts`: Web Audio playback and the soundtrack
- `src/config.ts`, `src/scoring.ts`, `src/storage.ts`, `src/weekly.ts`, `src/api.ts`: rules, saves, the weekly challenge and the server client
- `shared/`: used by both the game and the server (`weekly.js`, `chart-objects.json` from `npm run charts`)
- `api/_lib/`: the server: `core.js` (accounts, sessions, security), `online.js` (boards, feed), `versus.js` (1v1), `catalog.js`, `store.js` (Redis / Upstash / memory)
- `server.js`: Node server for Railway (static files with compression + the API); `api/index.js`: the same API as a Vercel function
- `scripts/`: music generation, analysis, `add-tracks.ts` (licensed tracks) and `chart-objects.ts`
- `src/app/importStore.ts`: imported songs kept on this computer (IndexedDB)
- `desktop/`: the app (Electron): `main.js` (window, keys, IPC, updates), `protocol.js` (serves the game at app://line-rush), `api-proxy.js` (server + login cookie), `discord.js`, `songs-folder.js`, `prefs.js`; `src/app/desktop.ts` is its side in the game
- `tests/`

Code is MIT licensed. The original music recipes and generated audio are dedicated to CC0; the licensed tracks keep their own licenses (see MUSIC-LICENSE.md).
