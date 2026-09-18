# Chinatown Historical Hunt — context for a new machine

Everything needed to pick this up on another computer, show it to someone, or continue
building it with Claude Code. Repo: `https://github.com/sudomellowlab/chinatown-hunt` (public).
Last updated 17 September 2026: the real game is built, tested and uploaded to
`https://nanobotinc.com/chinatown/`. See **5. Where the work stands** for open items.

---

## 1. What this is

A GPS treasure hunt for Telok Ayer / Ann Siang Hill in Singapore. A team walks with one
phone (their own); walking inside a location's circle opens it and presents its challenges one at a
time: arrival text, then each challenge's text and picture, with Back and Next. Teams
answer in LoQuiz; nothing is answered or scored on this site. Two hours by default. Near the
end of each team's clock a screen shows the clues and suspects.

**No server anywhere.** There are two HTML files, and that is the whole product:

| File | Who | What it does |
|---|---|---|
| `chinatown-hunt-admin.html` | you, on a computer | Build the game: drag pins, set radii, write arrival text and challenges. Test it with a location emulator. **Export game file**. Never give this file to participants. |
| `chinatown-hunt.html` | participants, on phones | The game you exported. No admin tools inside it, and its content is scrambled so the page source gives away no questions or answers. |

The flow is: **build in the admin file → Export → upload the exported file to a static
HTTPS host (yours is nanobotinc.com) → give participants that link.** Real GPS needs HTTPS.
The file can have any name; `index.html` only makes the folder address work on its own.
Upload updates over the same file so the link stays the same; teams keep their progress.

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

- **Preview as participant** (Export section): opens your game exactly as teams see it, in a
  phone-sized window. Tap Begin, then click the map (or a pin, or use **Go to**) to fake your
  location; the location opens after about 3 seconds, as on a real phone. **Skip to clues**
  jumps the clock; **Restart** starts over. Allow pop-ups for the page if it's blocked.
- **Answers:** in the challenge editor, pick Text, Number or Multiple choice under **Answer**
  (or leave it as "No answer here"). Teams then must answer that challenge on the phone
  before Next lets them on. "Next challenge" and "Finish location" in the admin panel (and
  the field tools) still step past one, for testing.
- **Clues screen:** in the admin panel, **Show the clues screen now** previews it; dragging
  the **Clock** slider (State section) below the reveal time triggers it for real.
- **Admin file:** open it, then in the panel use **Jump to a location…** under Position
  source. That drops a simulated position on the pin, the location opens, and the
  challenges appear exactly as a participant would see them. **Simulated walk → Draw path
  → Walk it** plays a walk at a chosen speed. A banner across the top says it is the admin
  file, and a gold notice marks simulated positions.
- **Field tools in the exported file:** type a **Field tools password** in the Export
  section before exporting. On a phone playing that file, tap the timer 5 times quickly (or
  the title on the start, location or clues screen) and enter the password. The panel shows
  position, accuracy and a fix log, and can pretend to be at a location (or wherever you tap
  the map), open or finish a location, set the minutes left, show the clues, and restart the
  phone. It only affects that phone, and it locks again when the page reloads.
- **Participant file:** it uses real GPS unless the field tools are used. To demo it on a laptop, open Chrome DevTools
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

- The draft is saved per address: always open the admin file at
  `http://localhost:8765/dist/chinatown-hunt-admin.html`. A double-clicked copy or another
  port starts from the default game (your work isn't lost, it's just under the other address).
  If the page doesn't load, start the server: `python3 -m http.server 8765 --bind 127.0.0.1`.
- Keep your exports **outside** the repo's `dist/` folder (e.g. Downloads): every build and
  test run overwrites `dist/chinatown-hunt.html` with the default game. Never commit an
  export: the repo is public and the file holds your content and map key.
- The **field tools password** is saved only in that browser, not in the export. Note it
  down, and type it again on the laptop before exporting from there.

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
- Admin location editor: add, rename, reorder and delete locations; drag pins, paste
  coordinates or a Google Maps link, set radius. The game title, start screen text and clues
  screen text are editable too.
- **Export game file** producing the participant file, with the admin tools stripped out
  and the content scrambled. With a field tools password set, the file also carries a
  developer panel, encrypted with that password (the password itself isn't in the file).
- Challenges: text and an optional picture each, shown one at a time with Back and Next and
  Finish location on the last; the admin editor to add, edit, reorder and delete them.
- Answers (optional, per challenge): text, number or multiple choice. Teams must get it right
  here before moving on; wrong tries just say "Not quite. Try again." Text answers may use
  * for "anything" (*ple* accepts any answer containing "ple"), capitals and extra spaces are
  ignored, and several accepted answers can be listed one per line. Numbers ignore commas.
  Challenges with no answer set are unchanged: teams read them and answer in LoQuiz.
- Starting challenge (optional, 18 September 2026): opens as soon as a team taps Begin, with no
  location needed. It asks first for a password the LoQuiz host gives out (capitals and extra
  spaces don't matter) under wording you can change, then shows its text and challenges; no location opens until it's
  finished. Set up under **Starting challenge** in the admin panel, with **Try it here**. In the
  exported file its content is encrypted with the password, so the file gives away neither.
  Importing a game file with one asks for that password.
- Google Maps: paste a Google Maps Platform key (Map Tiles API) under **Map** in the admin
  panel and the map becomes Google's, with a Map/Satellite switch. Confirmed working with the real
  key on localhost on 16 September 2026. Without a key, or if
  Google refuses it, the map falls back to OpenStreetMap, and the panel says why.
- Links: select words in a text box and click **Add link** (or type `[words](https://…)`);
  teams see a tappable link that opens in a new tab.
- Images: challenge questions, clues and suspects can each show a picture, linked by an
  `https://` address on your own server. **Check image links** in the admin panel tests them
  all. Phones download every picture when the team taps Begin.
- Clues & suspects: you set the game length, how many minutes before the end they appear,
  and both lists. At that point no new location can open (a team mid-location finishes it
  first), then one screen shows all clues and suspects. No accusation on this site.
- 156 unit tests and 114 browser tests, run by CI on every push.

**Live (17 September 2026)**
- Real content is in: 9 locations, 60 challenges (49 with pictures on
  `nanobotinc.com/chinatown/…`), 5 clues, 8 suspects, 15 m radii, field tools password set.
- The export is uploaded at `https://nanobotinc.com/chinatown/`. Checked from here: the page
  loads, Google accepted the key from that site (Google map, not OpenStreetMap), the page is
  a secure context (GPS and the field tools password box work), and progress survives
  closing and reopening the browser (Continue returns to the same challenge and clock).
- Full play-through of the real file on an emulated phone passed: every location opens,
  every challenge screen renders, all 49 pictures and 5 links load, the clues screen shows
  on finishing everything, and the 100-minute reveal waits for an open location to finish.

**Open items**
1. **Progress seemed lost on the organiser's phone** after closing and reopening Chrome.
   Not reproduced: saving works on the live site. Waiting on two answers: did the start
   screen say **Continue** or **Begin**, and what exactly was in the address bar? Likely
   causes: the start screen shows on every open (Continue resumes), a different address
   (`http://` vs `https://`, `www.` vs not: each keeps separate progress), or Incognito.
2. **Server redirect (suggested, not done):** `http://nanobotinc.com/chinatown/` loads without
   redirecting to https, where phones refuse GPS. An Apache `.htaccess` in the site root:
   ```apache
   RewriteEngine On
   RewriteCond %{HTTPS} off [OR]
   RewriteCond %{HTTP_HOST} ^www\. [NC]
   RewriteRule ^ https://nanobotinc.com%{REQUEST_URI} [L,R=301]
   ```
   It affects the whole site; check with whoever runs the server.
3. **Offered, not built:** a "welcome back" start screen saying where the team is
   (location, challenge, time left) above Continue.
4. **Content fixes found in the review** (edit in the admin panel, export, re-upload):
   - Ann Siang Hill challenge 1 says to "type the number below": there's nowhere to type.
   - East India Company challenge 5 mentions an audio clip: there's no audio on this site.
   - Two very large pictures, Telok Ayer challenges 3 and 8 (2.9 MB and 4.4 MB). Every
     picture downloads at Begin, about 17 MB in total; shrink these to about 300 KB.
   - Raffles History has no arrival text.
   - Typos: "Durgha" (Nagore Dargah 1), "kept on eye" (clue 2), "thief clothing" (clue 4);
     the Club Street 5 picture reads "January 2920".
   - Same picture at Telok Ayer 2 and Ann Siang Hill 3; same link at Amoy Street 7 and 8.
     Fine if deliberate.
5. **Geofence spacing:** Raffles History and Club Street are only 10 m apart edge to edge
   (Nagore Dargah and Telok Ayer 12 m). A team walking to one through the other gets locked
   into the first. Move a pin or shrink a radius if that's a likely route.
6. **15 m radii:** a simulation says they open within seconds with GPS error up to about
   ±15 m, and about 1 in 10 teams wait over 30 s at ±20 m. Real GPS among the towers
   can be worse; the "I'm standing right here" button appears after 90 s within 60 m. A real
   walk with the walk recorder (admin file on a phone) would settle it.
7. **Untested:** the field tools panel on the real file (needs the password), a real walk on
   site, and Download/Share of walk recordings on iOS Safari.

**Google key:** website restrictions now allow the live site (confirmed working). Keep the
`http://localhost:8765/*` entry so the admin file keeps Google's map.

---

## 6. The rules the game follows

Agreed with you, and they override the older `SPEC.md`:
- Challenges at a location run **strictly in order**.
- **Nothing is answered here.** Teams answer in LoQuiz. A challenge is its text and an
  optional picture: no answer boxes, options, hints or points.
- **Back and Next** move between challenges; **Finish location** is on the last one.
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
