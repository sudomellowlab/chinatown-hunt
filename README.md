# Chinatown Historical Hunt

## Working from a machine with nothing installed

**Just want the app?** Download the built file from CI:

1. On GitHub, open **Actions → CI** and click the latest successful run on `main`.
2. Under **Artifacts**, download **chinatown-hunt.html**. It downloads as the HTML file itself, not a zip. You need to be signed in to GitHub, and artifacts expire after 30 days, so push a commit to get a fresh one.
3. Double-click it to open it in a browser, or drag it onto a static HTTPS host such as Netlify Drop to use it on a phone. Real GPS only works over HTTPS. Add `?dev=1` to the URL for the location emulator.

**Want to change it?** Open a Codespace:

1. On the repo page, click **Code → Codespaces → Create codespace on main**. To reopen one you've already made, go to **github.com/codespaces**.
2. Wait for setup to finish. It installs Node 22, Playwright's Chromium and Claude Code, with nothing to do on your part.
3. To work with Claude Code, run `claude` in the Codespace terminal and sign in. You stay signed in when the Codespace stops and resumes; a new Codespace asks again.
4. In the Codespace terminal:

   ```bash
   node --test          # unit tests
   node build.js        # writes dist/chinatown-hunt.html
   npx playwright test  # browser tests (already set up in a Codespace)
   python3 -m http.server 8765
   ```

   Then open the forwarded port 8765 from the **Ports** tab and go to `/dist/chinatown-hunt.html?dev=1` or `/src/index.html?dev=1`. The forwarded URL is HTTPS. It's private to your GitHub account by default, so to open it on a phone either sign in to GitHub there or set the port's visibility to Public, and set it back afterwards.

The same commands work on any machine with Node 22 (see `.nvmrc`). No `npm install` is needed to build or run the unit tests.

---

`SPEC.md` is the product brief, `HANDOFF.md` is the current order of work, and `CLAUDE.md` covers the layout, commands and the engine rules that must not change.
