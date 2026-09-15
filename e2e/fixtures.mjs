// Shared setup for the browser tests: serves the built file, drives geolocation, picks test positions.
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Engine } from "../src/engine.js";
export { expect };

// Served from a fake HTTPS origin via request routing: a secure context for geolocation, no server needed.
const ORIGIN = "https://hunt.test";
const APP = `${ORIGIN}/chinatown-hunt.html`;
const ADMIN_FILE = new URL("../dist/chinatown-hunt-admin.html", import.meta.url);
const PLAY_FILE = new URL("../dist/chinatown-hunt.html", import.meta.url);

export const CEILING = 50;             // GAME.defaults.accuracyCeiling
export const GOOD = 8;                 // accuracy for fixes that should be accepted

/* ── geometry, using the engine's own distance maths ───────────────────── */

const R = 6371000, rad = Math.PI / 180;
export function offset(from, metres, bearingDeg) {
  const b = bearingDeg * rad, dr = metres / R, la = from.lat * rad, lo = from.lng * rad;
  const lat = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
  const lng = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(lat));
  return { lat: lat / rad, lng: lng / rad };
}
const rangesAt = (p, locs) => Engine.ranges({ ...p, accuracy: GOOD }, locs, { radius: 25 });
// Clear of every geofence by at least `margin` metres.
const clearOfAll = (p, locs, margin) => rangesAt(p, locs).every(g => g.d > g.r + margin);

// A location whose centre is well outside every other geofence, and an approach
// bearing along which the walker stays outside all geofences until arrival.
export function pickArrival(locs) {
  for (const loc of locs) {
    const others = locs.filter(l => l.id !== loc.id);
    if (!clearOfAll(loc, others, 10)) continue;
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const approach = [150, 100, 60].map(m => offset(loc, m, bearing));
      if (approach.every(p => clearOfAll(p, locs, 5))) return { loc, approach };
    }
  }
  throw new Error("no location with a clear approach — check GAME.locations");
}

// A spot within override range (60 m) of one location, outside every geofence,
// and nearer that location than any other.
export function pickLoiter(locs) {
  for (const loc of locs) for (const m of [40, 45, 50, 35]) for (let bearing = 0; bearing < 360; bearing += 15) {
    const p = offset(loc, m, bearing), r = rangesAt(p, locs);
    if (r[0].id === loc.id && r[0].d < 55 && clearOfAll(p, locs, 5)) return { loc, at: p };
  }
  throw new Error("no loiter spot within 60 m of a location — check GAME.locations");
}

/* ── page driving ──────────────────────────────────────────────────────── */

/* Drive one app in one browser page. The test fixture below wraps this for the project's page;
   tests that need a second device (e.g. a participant phone) call it with their own context. */
export async function createApp({ page, context }) {
    let source = () => readFileSync(ADMIN_FILE, "utf8");
    let patchHtml = html => html;
    await context.route(`${ORIGIN}/**`, route =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: patchHtml(source()) }));
    await context.route(/tile\.openstreetmap\.org/, route => route.abort());   // map tiles: noise, not under test
    await context.grantPermissions(["geolocation"], { origin: ORIGIN });

    // Count watchPosition errors as the app receives them, without changing what it receives.
    // Chromium's emulation delivers a POSITION_UNAVAILABLE (code 2) error immediately before every
    // setGeolocation() update, so every test here exercises transient-error handling for free.
    await page.addInitScript(() => {
      const geo = navigator.geolocation, watch = geo.watchPosition.bind(geo);
      window.__geoErrors = []; window.__geoWatches = 0;
      geo.watchPosition = (ok, err, opts) => { window.__geoWatches++; return watch(ok, e => { window.__geoErrors.push(e.code); err?.(e); }, opts); };
    });

    // No alert may appear unless a test expects exactly that message.
    // Expected confirms can be accepted; everything else is dismissed.
    const dialogs = [], expectedDialogs = [], accept = new Set();
    page.on("dialog", d => { dialogs.push(d.message()); (accept.has(d.message()) ? d.accept() : d.dismiss()).catch(() => {}); });

    let fixes = 0, nudge = 0;
    const app = {
      // file: "admin" (default) or "play" for the default participant file; html: serve this page instead.
      // patch: edit the served HTML, e.g. to change GAME. Throws if the edit doesn't apply.
      async open({ file = "admin", html, patch, query = "" } = {}) {
        if (html) source = () => html;
        else source = () => readFileSync(file === "play" ? PLAY_FILE : ADMIN_FILE, "utf8");
        if (patch) patchHtml = h => { const out = patch(h); if (out === h) throw new Error("patch did not apply"); return out; };
        await page.goto(APP + query);
        await expect(page.locator(".pin")).toHaveCount(8);
        if (await page.locator("#drawer").count()) await app.closeTools();   // admin file: start from the map
      },
      isAdmin: async () => (await page.locator("#drawer").count()) > 0,
      // Participant file: tap Begin (or Continue) with a first fix at `p`.
      async begin(p, accuracy = GOOD) {
        await context.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy });
        await page.locator("#startBtn").click();
        await expect(page.locator("#start")).toBeHidden();
        await expect(page.locator("#srctxt")).toHaveText("live GPS");
        await expect(page.locator("#fixcount")).toHaveText("1");
        fixes = 1;
      },
      geoWatches: () => page.evaluate(() => window.__geoWatches),
      // Open or close the admin & dev tools, whatever state they are in.
      toolsOpen: () => page.locator("#drawer").evaluate(el => el.classList.contains("up")),
      async openTools() { if (!(await app.toolsOpen())) await page.locator("#devbtn").click(); },
      async closeTools() { if (await app.toolsOpen()) await page.locator("#drawerclose").click(); },
      expectDialog(message, { accept: yes = false } = {}) { expectedDialogs.push(message); if (yes) accept.add(message); },
      geoErrors: () => page.evaluate(() => window.__geoErrors),

      // Location data as the app sees it, via the coordinate capture tool's export.
      async locations() {
        await app.openTools();
        await page.locator("details.more").evaluate(d => { d.open = true; });
        await page.locator("#capExport").click();
        const locs = JSON.parse(await page.locator("#capOut").inputValue());
        await app.closeTools();
        return locs;
      },

      // Start real GPS from the drawer, with a first fix at `p`.
      async startGps(p, accuracy = GOOD) {
        await context.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy });
        await app.openTools();
        await page.locator("#srcReal").click();
        await expect(page.locator("#srctxt")).toHaveText("live GPS");
        await expect(page.locator("#fixcount")).toHaveText("1");
        fixes = 1;
        await app.closeTools();
      },

      // Move the emulated position and wait until the app has taken exactly one more fix.
      // Each fix is nudged a few centimetres so consecutive identical positions still count as updates.
      async fix(p, accuracy = GOOD) {
        const q = offset(p, 0.05, (nudge++ * 90) % 360);
        await context.setGeolocation({ latitude: q.lat, longitude: q.lng, accuracy });
        await expect(page.locator("#fixcount")).toHaveText(String(++fixes));
      },

      reached: () => page.locator("#reached"),              // locations finished
      opened: () => page.locator(".pin.active, .pin.reached"),   // locations opened: in progress or finished
      sheet: () => page.locator("#sheet"),
      pin: id => page.locator(`.pin[data-id="${id}"]`),
      dialogs,
    };
    const done = () => expect(dialogs, "no alerts other than the ones the test expects").toEqual(expectedDialogs);
    return { app, done };
}

export const test = base.extend({
  app: async ({ page, context }, use) => {
    const { app, done } = await createApp({ page, context });
    await use(app);
    done();
  },
});

export const far = locs => offset(locs[0], 600, 180);   // well away from everything
