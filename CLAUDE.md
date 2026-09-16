# Chinatown Historical Hunt

A GPS treasure hunt for one phone per team, walking eight locations around Telok Ayer and Ann Siang Hill in Singapore. Walking into a location's geofence opens it, and each location presents a sequence of challenges. There is no backend: an admin builds the game in the admin file and exports a single self-contained participant file to a static HTTPS host; progress lives in `localStorage`.

**Two files, two audiences.**
- `dist/chinatown-hunt-admin.html`: the admin file, used in a desktop browser. Tools always on (panel docked beside the map at 960 px and wider; a full-screen sheet on a phone for field testing). Set up the game, test it, and **Export game file**. Design admin features for a computer first.
- `dist/chinatown-hunt.html` / the exported file: what participants play on phones. Built without `admin.js` or the admin markup, game content sealed with `Pack`, a start screen with Begin/Continue. The build fails if admin code or readable location text leaks into it.

## Layout

```
src/game.js          GAME: the default game content (id is permanent; progress is keyed by it)
src/engine.js        geofence engine: pure functions
src/play.js          game rules: answer checking, scoring, challenge sequence, one-location-at-a-time, validation: pure
src/pack.js          seal/open the game content for the participant file: pure (scrambling, not encryption)
src/session.js       walk recording and walk-file format: pure, shared by the admin tools and the CLI
src/poi.js           hand-placed location edits and coordinate parsing: pure
src/app.js           the game participants run: map, GPS, HUD, location sheet (arrival → challenges → summary), start screen; exposes hooks
src/admin.js         admin & dev tools: the draft, locations + challenges editor, export/import, emulator, recorder, replay (admin file only)
src/styles.css
src/index.html       markup for both files; admin-only parts sit between <!-- admin:start/end --> markers
build.js             zero-dependency Node script: builds both files, embeds the participant page in the admin file
scripts/replay.js    CLI: replay a recorded walk through the engine, report per location, sweep parameters
dist/                gitignored build output (also published by CI as artifacts)
test/*.test.js       unit tests: engine, play, pack, session, poi, replay CLI (node --test picks up everything under test/)
e2e/*.spec.mjs       Playwright tests of the built file via real geolocation emulation; shared setup in e2e/fixtures.mjs
playwright.config.mjs, package.json   npm is only for Playwright; the package is ESM ("type": "module")
.claude/launch.json  preview server config
.github/workflows/ci.yml   tests, build, uploads both HTML files as artifacts
.devcontainer/, .nvmrc     Codespace setup: Node 22 + Playwright Chromium
```

## Commands

```bash
node --test          # unit tests, no install needed
node build.js        # writes dist/chinatown-hunt-admin.html and dist/chinatown-hunt.html
npm ci && npx playwright install chromium   # once, for browser tests
npx playwright test  # browser tests; builds first
node scripts/replay.js walks/x.json --radius 25 --ceiling 50 --streak 3   # replay a walk (--sweep for a grid, --help)
python3 -m http.server 8765 --bind 127.0.0.1   # preview: /dist/chinatown-hunt-admin.html (admin) or /dist/chinatown-hunt.html (participant)
```

Playwright runs two projects: `phone` (Pixel 7: the game, challenges, participant access, recorder) and `desktop` (1440×900: location and challenge editor, export, recorder, replay). Export and editor tests play the exported file in a separate phone context. Browser tests read location coordinates from the page and pick test positions geometrically, so they survive real coordinates replacing the placeholders. Chromium's geolocation emulation sends a code-2 "position unavailable" error before every emulated update, which conveniently exercises the app's transient-error handling; any alert a test doesn't expect fails it.

`src/index.html` needs a local server because it loads modules (Export only works in the built admin file); `dist/` files also open by double-clicking. Ask before adding any dependency; Leaflet and Playwright are the only ones agreed.

## Invariants — these look like bugs but aren't

- **`src/engine.js` has no DOM access and no imports.** Tests import it directly; keep it pure.
- **Every fix enters through one function** (`onFix` → `Engine.ingest`), whether it's real, simulated or replayed. Nothing branches on a fix's source; if it did, the tests and emulator would stop proving anything about live behaviour.
- **A rejected fix leaves streaks untouched.** It doesn't reset them. One bad reading must never undo progress from good ones, and tests fail if this is "fixed".
- **Opened locations never re-lock**, however far the walker goes afterwards.
- **The participant file contains no admin code, and no readable game content.** Keep admin features in `admin.js` and inside the admin markers; `app.js` only offers hooks. Game content goes in the sealed pack, never as literals in `app.js`.
- **The admin's draft wins over `src/game.js`.** Everything built in the admin panel is saved in the browser as a draft (`chinatown-hunt-m1:draft`) and is never overwritten by a change to the default game; only Start over discards it. Import game file restores a draft from any exported file. The exported file is how the draft reaches participants.
- **Game rules live in `play.js`, and override SPEC.md:** challenges strictly in order, one attempt each (wrong = 0, no retry, no skip), hints cost points but never below 0, and once a location opens no other can open until it is finished (`Play.openable` filters what the engine sees; `Play.activate` refuses a second active location). Answers are keyed by permanent task id, so a re-uploaded game keeps progress.
- **Replayed fixes aren't recorded.** The recorder skips `source === "replay"`, so exporting after a replay doesn't duplicate the walk. This is recorder bookkeeping, not engine logic; the engine never sees `source`.
- **The manual-override dwell timer uses each fix's `t`, never the wall clock**, so replays at any speed reach the same verdict as a live walk. Rejected fixes neither start nor clear a timer.
- **Each built file stays single and self-contained.** No bundler, no framework, no npm install needed to produce them.

Walk files hold timestamped GPS tracks and the repo is public, so `walks/` is gitignored.

## Docs

- `SPEC.md`: the full product brief (game content shape, engine rules, screens, dev mode, design). Its "single HTML file, no build step" constraint has been relaxed to the `src/` + `build.js` layout above.
- `HANDOFF.md`: the current order of work, which overrides SPEC.md's build order. Steps 1–4 are done. The user's game-builder plan now leads: (1) export the participant file (done), (2) challenges per location with their admin editor (done), (3) start location: dropped, every location is open from the start, (4) clues, suspects, deduction, end screen: next. Game rules that override SPEC.md: challenges strictly sequenced, one attempt each (wrong = 0, no retries, no skip), hints cost points, no leaving a location until it's finished. Stop for review after each step, and commit at each step.
