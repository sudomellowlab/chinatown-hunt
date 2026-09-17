# Chinatown Historical Hunt

## Working from a machine with nothing installed

**Just want to set up a game?** Download the admin file from CI:

1. On GitHub, open **Actions → CI** and click the latest successful run on `main`.
2. Under **Artifacts**, download **chinatown-hunt-admin.html**. It downloads as the HTML file itself, not a zip. You need to be signed in to GitHub, and artifacts expire after 30 days, so push a commit to get a fresh one.
3. Open it in your computer's browser (double-click is fine). Drag the pins where you want them, then click **Export game file**.
4. Upload the exported `chinatown-hunt.html` to a static HTTPS host such as Netlify Drop and give participants that link. Real GPS only works over HTTPS. Never hand out the admin file.
5. Optional: set a **Field tools password** in the Export section before exporting. On a phone playing the exported game, tap the timer 5 times quickly and enter it to open the field tools (position, fix log, open or finish a location, clock, restart). The tools are encrypted with that password inside the file.

**Want to change it?** Open a Codespace:

1. On the repo page, click **Code → Codespaces → Create codespace on main**. To reopen one you've already made, go to **github.com/codespaces**.
2. Wait for setup to finish. It installs Node 22, Playwright's Chromium and Claude Code, with nothing to do on your part.
3. To work with Claude Code, run `claude` in the Codespace terminal and sign in. You stay signed in when the Codespace stops and resumes; a new Codespace asks again.
4. In the Codespace terminal:

   ```bash
   node --test          # unit tests
   node build.js        # writes dist/chinatown-hunt.html
   npx playwright test  # browser tests (already set up in a Codespace)
   node scripts/replay.js walks/my-walk.json --sweep   # tune radius/ceiling against a recorded walk
   python3 -m http.server 8765
   ```

   Then open the forwarded port 8765 from the **Ports** tab and go to `/dist/chinatown-hunt-admin.html` (admin) or `/dist/chinatown-hunt.html` (participant). The forwarded URL is HTTPS. It's private to your GitHub account by default, so to open it on a phone either sign in to GitHub there or set the port's visibility to Public, and set it back afterwards.

The same commands work on any machine with Node 22 (see `.nvmrc`). No `npm install` is needed to build or run the unit tests.

---

`SPEC.md` is the product brief, `HANDOFF.md` is the current order of work, and `CLAUDE.md` covers the layout, commands and the engine rules that must not change.
