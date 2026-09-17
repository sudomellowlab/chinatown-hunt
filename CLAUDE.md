# Chinatown Historical Hunt

A GPS treasure hunt for one phone per team (teams use their own phones), walking a set of locations around Telok Ayer and Ann Siang Hill in Singapore. Walking into a location's geofence opens it and shows its arrival text, then its challenges one at a time (text and an optional picture). Teams answer in LoQuiz: nothing is answered or scored on this site. Near the end of each team's clock, a single screen shows the clues and suspects. There is no backend: an admin builds the game in the admin file and exports a single self-contained participant file to a static HTTPS host; progress lives in `localStorage`.

**Two files, two audiences.**
- `dist/chinatown-hunt-admin.html`: the admin file, used in a desktop browser. Tools always on (panel docked beside the map at 960 px and wider; a full-screen sheet on a phone for field testing). Set up the game, test it, and **Export game file**. Design admin features for a computer first.
- `dist/chinatown-hunt-admin.html?preview`: **Preview as participant**, opened from the admin panel in a phone-sized window. The admin file in `data-build="preview"` mode (set by an admin-only inline script before the modules run): admin tools hidden, start screen shown, the draft applied, its own progress key (`chinatown-hunt-preview:`), and `navigator.geolocation` replaced by a fake fed by map/pin clicks and a Go to list, so positions still take the real watchPosition path. A real URL, not a blob window, because Google's key check needs the page's address as referrer. Preview code and its CSS live only in admin.js and the admin markers; build.js refuses them in the participant file.
- `dist/chinatown-hunt.html` / the exported file: what participants play on phones. Built without `admin.js` or the admin markup, game content sealed with `Pack`, a start screen with Begin/Continue. The build fails if admin code or readable location text leaks into it.
- **Field tools** in an exported file: if the admin set a field tools password (kept in the admin's browser at `chinatown-hunt-m1:fieldpass`, never in the draft or the game), Export encrypts `field.js` with it (`Vault`) into the `"__FIELD_PACK__"` slot; otherwise the slot is `null` and there are no tools. `unlock.js` opens a password box after 5 taps within 3 s on `#clock`, `#startTitle`, `#sheetname` or `#revealTitle`, decrypts, and runs the code with `new Function`, passing the game's functions as `app`. The panel and its CSS are built by field.js, so none of it is readable in the file; build.js refuses its markers in the participant template. Pretend positions go through `onFix` with source `sim`. Unlocking lasts until the page reloads.

## Layout

```
src/game.js          GAME: the default game content (id is permanent; progress is keyed by it)
src/engine.js        geofence engine: pure functions
src/play.js          game rules: stepping through a location (Back/Next/Finish), one-location-at-a-time, the timed clues reveal, validation: pure
src/pack.js          seal/open the game content for the participant file: pure (scrambling, not encryption)
src/vault.js         password encryption (PBKDF2 + AES-GCM, Web Crypto) for the field tools: pure
src/session.js       walk recording and walk-file format: pure, shared by the admin tools and the CLI
src/poi.js           hand-placed location edits and coordinate parsing: pure
src/app.js           the game participants run: map (Google Map Tiles API or OSM fallback), GPS, HUD, location sheet (arrival → challenges, Back/Next, Finish location), clues & suspects screen, start screen; exposes hooks
src/field.js         field tools: the developer panel inside an exported game (never shipped as readable code)
src/unlock.js        participant file only: five taps + password box; decrypts and runs field.js
src/admin.js         admin & dev tools: the draft, game text, locations (add/rename/reorder/delete) + challenges editor, clues/suspects/timing editor, export/import, emulator, recorder, replay (admin file only)
src/styles.css
src/index.html       markup for both files; admin-only parts sit between <!-- admin:start/end --> markers
build.js             zero-dependency Node script: builds both files, embeds the participant page in the admin file
scripts/replay.js    CLI: replay a recorded walk through the engine, report per location, sweep parameters
dist/                gitignored build output (also published by CI as artifacts)
test/*.test.js       unit tests: engine, play, pack, vault, session, poi, replay CLI (node --test picks up everything under test/)
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

Playwright runs two projects: `phone` (Pixel 7: the game, challenges, the clues reveal, images, Google map, participant access, recorder) and `desktop` (1440×900: game setup, location, challenge and clues editors, images, map key, export, preview, field tools, recorder, replay). Images are served by a fake `https://img.test` in the fixtures; `app.images.failing` makes a path 404. Reveal tests use Playwright's fake clock. Export and editor tests play the exported file in a separate phone context. Browser tests read location coordinates from the page and pick test positions geometrically, so they survive real coordinates replacing the placeholders. Chromium's geolocation emulation sends a code-2 "position unavailable" error before every emulated update, which conveniently exercises the app's transient-error handling; any alert a test doesn't expect fails it.

`src/index.html` needs a local server because it loads modules (Export only works in the built admin file); `dist/` files also open by double-clicking. Ask before adding any dependency; Leaflet and Playwright are the only ones agreed.

## Invariants — these look like bugs but aren't

- **`src/engine.js` has no DOM access and no imports.** Tests import it directly; keep it pure.
- **Every fix enters through one function** (`onFix` → `Engine.ingest`), whether it's real, simulated or replayed. Nothing branches on a fix's source; if it did, the tests and emulator would stop proving anything about live behaviour.
- **A rejected fix leaves streaks untouched.** It doesn't reset them. One bad reading must never undo progress from good ones, and tests fail if this is "fixed".
- **Opened locations never re-lock**, however far the walker goes afterwards.
- **The participant file contains no admin code, and no readable game content.** Keep admin features in `admin.js` and inside the admin markers; `app.js` only offers hooks. The one exception is the field tools, which travel only encrypted with the organiser's password; never put their code or the password in the file in readable form. Game content goes in the sealed pack, never as literals in `app.js`.
- **Locations are fully editable in the admin panel** (name, add, delete, reorder; pin numbers follow list order), as are the game title, start screen text (`intro`) and clues screen text (`revealIntro`). Pins are drawn by `rebuildLocations()` in app.js; the admin file calls it after every add/delete/reorder and wires its handlers through `hooks.pinCreated`, so never attach handlers to `pins[id]` directly. New location ids are `l-…` and permanent. Nothing may assume there are exactly eight locations.
- **The admin's draft wins over `src/game.js`.** Everything built in the admin panel is saved in the browser as a draft (`chinatown-hunt-m1:draft`) and is never overwritten by a change to the default game; only Start over discards it. Import game file restores a draft from any exported file. The exported file is how the draft reaches participants.
- **Light colours only.** `<meta name="color-scheme" content="only light">` and `color-scheme: only light` opt out of browsers' automatic darkening; the user chose this over a dark theme. Don't add `prefers-color-scheme` styles.
- **An open location takes the whole screen.** `#sheet` covers the map, HUD and status strip (maximum reading space on a phone); its Back/Next/Finish row is sticky at the bottom. The map returns when the location is finished.
- **Game rules live in `play.js`, and override SPEC.md:** a location shows its arrival text, then its challenges in order; teams move with Back and Next, and Finish location appears only on the last challenge (or on the arrival text of a location with none). Once a location opens no other can open until it is finished (`Play.openable` filters what the engine sees; `Play.activate` refuses a second active location). Progress stores `at[locId]`, the challenge index being viewed, and a re-uploaded game with fewer challenges clamps it.
- **Nothing is answered on this site.** Teams answer in LoQuiz. A challenge is `{ id, prompt, image }` only: no types, options, answers, hints or points, and export strips any such fields left in older drafts. A browser test fails if an input, an option, a hint or words like "points", "correct", "score" or "submit" appear on a participant's screen.
- **The base map is Google's Map Tiles API inside Leaflet, with OpenStreetMap as the fallback.** The key lives in `GAME.map.googleKey`, pasted in the admin panel and exported with the game; never commit a real key (the repo is public). Each device caches its session token (2 weeks) in localStorage; a refused key or refused tiles falls back to OSM quietly for teams and with the reason in the admin panel. Google requires "Google Maps" plus the viewport copyright on the map; don't remove them. Tests fake `tile.googleapis.com` (keys starting `bad` are refused, `notiles` get no tiles).
- **Images are linked, never embedded.** Challenges, clues and suspects may have an `image`: an https URL on the organiser's server (`Play.imageProblem` refuses anything else, since phones block http images on an https page). Begin preloads every image; a failed one shows "Image didn't load" with Try again. Keep the game files small: no base64 images.
- **Links in organiser text are written `[words](https://…)`** in challenge text, arrival text, clues, suspect blurbs and both intros. `Play.parseLinks` turns only http(s) addresses into links (anything else stays plain text and `Play.linkProblems` reports it, blocking export); app.js renders them with `linked()` as `<a target="_blank" rel="noopener noreferrer">` so the game stays open. Never render organiser text as HTML.
- **Build DOM with `h()` and `fill()` in app.js.** `replaceChildren` prints `null` as text; `fill` skips missing pieces. A browser test fails if "null" or "undefined" appears on a participant's screen.
- **The admin file never reveals the clues on its own.** `hooks.revealPaused` holds the reveal (and its "no new locations" effect) while editing, whatever the clock says or however many locations are done, until the Clock slider is used to test it; Reset progress pauses it again, and a saved `revealed` is cleared on load. The preview and the participant file keep the real timing.
- **The clues reveal is timed per team and sticky.** From `revealMinutes` before the end of the team's own clock (started at Begin), or once every location is finished, no new location can open; a team mid-location finishes it first; then the clues & suspects screen shows, GPS stops, and `progress.revealed` keeps it up for good. There is no accusation on this site. No per-location clues, no elimination matrix, no end screen (SPEC.md's versions are superseded).
- **Replayed fixes aren't recorded.** The recorder skips `source === "replay"`, so exporting after a replay doesn't duplicate the walk. This is recorder bookkeeping, not engine logic; the engine never sees `source`.
- **The manual-override dwell timer uses each fix's `t`, never the wall clock**, so replays at any speed reach the same verdict as a live walk. Rejected fixes neither start nor clear a timer.
- **Each built file stays single and self-contained.** No bundler, no framework, no npm install needed to produce them.

Walk files hold timestamped GPS tracks and the repo is public, so `walks/` is gitignored.

## Docs

- `SPEC.md`: the full product brief (game content shape, engine rules, screens, dev mode, design). Its "single HTML file, no build step" constraint has been relaxed to the `src/` + `build.js` layout above.
- `HANDOFF.md`: the current order of work, which overrides SPEC.md's build order. Steps 1–4 are done. The user's game-builder plan now leads: (1) export the participant file (done), (2) challenges per location with their admin editor (done), (3) start location: dropped, every location is open from the start, (4) timed clues & suspects screen (done). Game rules that override SPEC.md: challenges strictly sequenced, one attempt each, no points or verdicts shown, free hints, no leaving a location until it's finished, clues shown on a timer. Stop for review after each step, and commit at each step.
