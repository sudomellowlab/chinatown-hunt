# Chinatown Historical Hunt — context for a new machine

Everything needed to pick this up on another computer, show it to someone, or continue
building it with Claude Code. Repo: `https://github.com/sudomellowlab/chinatown-hunt` (public).
Last updated 16 September 2026, after step 4 (the timed clues & suspects screen).

---

## 1. What this is

A GPS treasure hunt for Telok Ayer / Ann Siang Hill in Singapore. A team walks with one
phone; walking inside a location's circle opens it and presents its challenges one at a
time. Eight locations, two hours. Near the end of each team's clock a screen shows the
clues and suspects. No points are shown on this site: scoring is done in LoQuiz.

**No server anywhere.** There are two HTML files, and that is the whole product:

| File | Who | What it does |
|---|---|---|
| `chinatown-hunt-admin.html` | you, on a computer | Build the game: drag pins, set radii, write arrival text and challenges. Test it with a location emulator. **Export game file**. Never give this file to participants. |
| `chinatown-hunt.html` | participants, on phones | The game you exported. No admin tools inside it, and its content is scrambled so the page source gives away no questions or answers. |

The flow is: **build in the admin file → Export → upload the exported file to a static
HTTPS host (Netlify Drop or similar) → give participants that link.** Real GPS needs HTTPS.

---

## 2. Start here on the laptop

### Fastest, nothing installed — just to show it
1. Go to the repo → **Actions** → **CI** → the latest green run on `main`.
2. Under **Artifacts** download **chinatown-hunt-admin.html** (and **chinatown-hunt.html**
   if you want the participant one). They download as plain HTML, not zips. You must be
   signed in to GitHub; artifacts expire after 30 days.
3. Double-click the admin file. It opens with the panel on the right and the map beside it.

### To change code, with nothing installed
Repo page → **Code → Codespaces → Create codespace on main**. It sets up Node 22,
Playwright and Claude Code by itself. Then in its terminal: `claude`.

### To work locally
```bash
git clone https://github.com/sudomellowlab/chinatown-hunt.git
cd chinatown-hunt
node build.js                    # writes both files into dist/
python3 -m http.server 8765      # then open http://localhost:8765/dist/chinatown-hunt-admin.html
```
Node 22+ only. `npm ci` is needed just for the browser tests.

---

## 3. Showing it without walking around Singapore

- **Clues screen:** in the admin panel, **Show the clues screen now** previews it; dragging
  the **Clock** slider (State section) below the reveal time triggers it for real.
- **Admin file:** open it, then in the panel use **Jump to a location…** under Position
  source. That drops a simulated position on the pin, the location opens, and the
  challenges appear exactly as a participant would see them. **Simulated walk → Draw path
  → Walk it** plays a walk at a chosen speed. A banner across the top says it is the admin
  file, and a gold notice marks simulated positions.
- **Participant file:** it uses real GPS only. To demo it on a laptop, open Chrome DevTools
  → ⋮ → More tools → **Sensors** → Location → custom, e.g. `1.28092, 103.84760`
  (Thian Hock Keng), then press **Begin**. Otherwise show it on a phone from a hosted link.
- **Phone view in a browser:** DevTools device toolbar, set to a phone size.

---

## 4. Your setup does not travel with the code

**The game you build lives in that browser, not in the repo.** Cloning on the laptop gives
you the placeholder game, not your edits.

To carry your work across: on the PC click **Export game file**, copy that
`chinatown-hunt.html` to the laptop, and in the laptop's admin file click
**Import game file…**. That restores everything: pins, radii, arrival text and challenges.
Keep your latest export as your backup; it is also what recovers your work if browser data
is ever cleared.

**Start over** in the admin panel is the only thing that discards your draft, and it asks
first.

---

## 5. Where the work stands

**Done**
- Map, GPS geofencing, and a location emulator for testing from a desk.
- Geofence engine: ignores fixes with poor accuracy, needs 3 good fixes in a row before
  opening, never re-locks, and a manual "I'm standing right here" override after 90
  seconds within 60 m.
- Walk recorder: records every GPS fix, exports as JSON, replays in-app, plus a
  command-line replay that reports per location and sweeps radius/accuracy settings.
- Admin location editor: drag pins, paste coordinates or a Google Maps link, set radius.
- **Export game file** producing the participant file, with the admin tools stripped out
  and the content scrambled.
- Challenges: multiple choice, typed answers, numbers, with free hints; the admin editor to
  add, edit, reorder and delete them. Answers are recorded but right/wrong is never shown.
- Images: challenge questions, clues and suspects can each show a picture, linked by an
  `https://` address on your own server. **Check image links** in the admin panel tests them
  all. Phones download every picture when the team taps Begin.
- Clues & suspects: you set the game length, how many minutes before the end they appear,
  and both lists. At that point no new location can open (a team mid-location finishes it
  first), then one screen shows all clues and suspects. No accusation on this site.
- 124 unit tests and 72 browser tests, run by CI on every push.

**Not built yet**
1. **Real content.** (A "starting location" step was planned and then dropped: every
   location is open from the start.) All eight locations still hold placeholder coordinates and
   placeholder challenges.

**Untested in the real world**
- The exported file on a real phone over HTTPS (worth one try before an event).
- Download/Share of walk recordings on iOS Safari.
- Whether a 25 m radius actually works among the shophouses. That is what the walk
  recorder and the replay sweep are for.

---

## 6. The rules the game follows

Agreed with you, and they override the older `SPEC.md`:
- Challenges at a location run **strictly in order**.
- **One attempt each.** No retries, no skip button.
- **No points and no right/wrong shown.** Scoring happens in LoQuiz. After answering, the
  team sees "Answer saved." and the next challenge. Hints are free.
- **Clues on a timer.** Each team's clock starts at Begin. From the set number of minutes
  before the end (20 by default), or once every location is done, the clues & suspects
  screen takes over and stays.
- **No leaving a location part-way.** Once it opens, every challenge must be answered
  before any other location can open.
- **Re-uploading an edited game keeps teams' progress**, because each challenge keeps a
  permanent hidden id.
- All of these rules are in `src/play.js`, which is pure and unit-tested.

---

## 7. If you continue with Claude Code

Point it at this repo and say what you want. It should read `CLAUDE.md` first (layout,
commands and the invariants that look like bugs but are not), then `HANDOFF.md` (order of
work) and `SPEC.md` (the original brief; parts are superseded).

Working agreements so far:
- Stop after each step for review, and commit at each step.
- Ask before adding any dependency. Only Leaflet and Playwright are agreed.
- Admin features are designed for a computer; participants are on phones.
- Tests come with the work: unit tests for rules, browser tests for behaviour, and each new
  rule is checked by deliberately breaking it to confirm a test catches it.

```bash
node --test          # unit tests, no install needed
node build.js        # build both HTML files into dist/
npx playwright test  # browser tests (needs npm ci && npx playwright install chromium once)
```

Git on this machine uses `mellow <rai@singexperience.sg>`. Recorded walks stay out of the
repo (`walks/` is ignored) because the repo is public and a walk is a timestamped GPS track.
