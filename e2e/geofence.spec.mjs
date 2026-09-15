// Browser tests against the built dist/chinatown-hunt.html, driving the genuine
// navigator.geolocation.watchPosition path with Playwright's geolocation emulation.
// The emulator in the dev drawer is deliberately not used for positions.
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Engine } from "../src/engine.js";

// Served from a fake HTTPS origin via request routing: a secure context for geolocation, no server needed.
const ORIGIN = "https://hunt.test";
const APP = `${ORIGIN}/chinatown-hunt.html`;
const DIST = new URL("../dist/chinatown-hunt.html", import.meta.url);

const CEILING = 50;             // GAME.defaults.accuracyCeiling
const GOOD = 8;                 // accuracy for fixes that should be accepted

/* ── geometry, using the engine's own distance maths ───────────────────── */

const R = 6371000, rad = Math.PI / 180;
function offset(from, metres, bearingDeg) {
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
function pickArrival(locs) {
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
function pickLoiter(locs) {
  for (const loc of locs) for (const m of [40, 45, 50, 35]) for (let bearing = 0; bearing < 360; bearing += 15) {
    const p = offset(loc, m, bearing), r = rangesAt(p, locs);
    if (r[0].id === loc.id && r[0].d < 55 && clearOfAll(p, locs, 5)) return { loc, at: p };
  }
  throw new Error("no loiter spot within 60 m of a location — check GAME.locations");
}

/* ── page driving ──────────────────────────────────────────────────────── */

const test = base.extend({
  app: async ({ page, context }, use) => {
    await context.route(`${ORIGIN}/**`, route =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: readFileSync(DIST, "utf8") }));
    await context.route(/tile\.openstreetmap\.org/, route => route.abort());   // map tiles: noise, not under test
    await context.grantPermissions(["geolocation"], { origin: ORIGIN });

    // An alert means watchPosition errored. Fail on any, except one known emulation artifact:
    // Chromium delivers a POSITION_UNAVAILABLE (code 2) error to watchers immediately before every
    // setGeolocation() update, even on a bare page with default options. Real permission (code 1)
    // and timeout (code 3) alerts still fail the test.
    const EMULATION_ARTIFACT = "No position available. Move into the open and try again.";
    const dialogs = [];
    page.on("dialog", d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

    let fixes = 0, nudge = 0;
    const app = {
      async open() { await page.goto(APP); await expect(page.locator(".pin")).toHaveCount(8); },

      // Location data as the app sees it, via the coordinate capture tool's export.
      async locations() {
        await page.locator("#devbtn").click();
        await page.locator("#capExport").click();
        const locs = JSON.parse(await page.locator("#capOut").inputValue());
        await page.locator("#drawerclose").click();
        return locs;
      },

      // Start real GPS from the drawer, with a first fix at `p`.
      async startGps(p, accuracy = GOOD) {
        await context.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy });
        await page.locator("#devbtn").click();
        await page.locator("#srcReal").click();
        await expect(page.locator("#srctxt")).toHaveText("live GPS");
        await expect(page.locator("#fixcount")).toHaveText("1");
        fixes = 1;
        await page.locator("#drawerclose").click();
      },

      // Move the emulated position and wait until the app has taken exactly one more fix.
      // Each fix is nudged a few centimetres so consecutive identical positions still count as updates.
      async fix(p, accuracy = GOOD) {
        const q = offset(p, 0.05, (nudge++ * 90) % 360);
        await context.setGeolocation({ latitude: q.lat, longitude: q.lng, accuracy });
        await expect(page.locator("#fixcount")).toHaveText(String(++fixes));
      },

      reached: () => page.locator("#reached"),
      sheet: () => page.locator("#sheet"),
      pin: id => page.locator(`.pin[data-id="${id}"]`),
      dialogs,
    };
    await use(app);
    expect(dialogs.filter(m => m !== EMULATION_ARTIFACT), "unexpected watchPosition error alert").toEqual([]);
    expect(dialogs.length, "at most one emulation artifact per position update").toBeLessThanOrEqual(fixes);
  },
});

const far = locs => offset(locs[0], 600, 180);   // well away from everything

/* ── tests ─────────────────────────────────────────────────────────────── */

test("a scripted approach opens the location only after the debounce", async ({ app }) => {
  await app.open();
  const locs = await app.locations();
  const { loc, approach } = pickArrival(locs);

  await app.startGps(far(locs));
  for (const p of approach) await app.fix(p);
  await expect(app.reached()).toHaveText("0");

  // consecutiveFixes is 3: inside twice is not enough…
  await app.fix(loc);
  await app.fix(offset(loc, 2, 45));
  await expect(app.reached()).toHaveText("0");
  await expect(app.sheet()).not.toHaveClass(/\bup\b/);
  await expect(app.pin(loc.id)).not.toHaveClass(/\breached\b/);

  // …the third opens it.
  await app.fix(offset(loc, 2, 225));
  await expect(app.reached()).toHaveText("1");
  await expect(app.pin(loc.id)).toHaveClass(/\breached\b/);
});

test("fixes with accuracy above the ceiling open nothing", async ({ app, page }) => {
  await app.open();
  const locs = await app.locations();
  const { loc } = pickArrival(locs);

  await app.startGps(far(locs));
  for (let i = 0; i < 5; i++) await app.fix(loc, CEILING + 30);
  await expect(app.reached()).toHaveText("0");
  await expect(app.sheet()).not.toHaveClass(/\bup\b/);

  // The rejections are visible in the fix log, with the reason.
  await page.locator("#devbtn").click();
  await expect(page.locator("#log .rej")).toHaveCount(5);
  await expect(page.locator("#log .rej").first()).toContainText(`over ${CEILING}m ceiling`);
  await page.locator("#drawerclose").click();

  // Accuracy exactly at the ceiling is accepted — and the rejected fixes didn't count toward the streak.
  await app.fix(loc, CEILING);
  await app.fix(loc, CEILING);
  await expect(app.reached()).toHaveText("0");
  await app.fix(loc, CEILING);
  await expect(app.reached()).toHaveText("1");
});

test("arrival shows the sheet with the right location name", async ({ app }) => {
  await app.open();
  const locs = await app.locations();
  const { loc, approach } = pickArrival(locs);

  await app.startGps(approach[0]);
  for (let i = 0; i < 3; i++) await app.fix(loc);

  await expect(app.sheet()).toHaveClass(/\bup\b/);
  await expect(app.sheet()).toBeInViewport({ ratio: 0.5 });
  await expect(app.sheet().locator("#sheetname")).toHaveText(loc.name);
  await expect(app.sheet().locator("#sheettext")).not.toBeEmpty();
});

test("progress survives a page reload", async ({ app, page }) => {
  await app.open();
  const locs = await app.locations();
  const { loc, approach } = pickArrival(locs);

  await app.startGps(approach[0]);
  for (let i = 0; i < 3; i++) await app.fix(loc);
  await expect(app.reached()).toHaveText("1");

  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await expect(app.reached()).toHaveText("1");
  await expect(app.pin(loc.id)).toHaveClass(/\breached\b/);
  await expect(page.locator(".pin.reached")).toHaveCount(1);
  await expect(app.sheet()).not.toHaveClass(/\bup\b/);
});

test("the manual override appears after 90s within 60m, and not before", async ({ app, page }) => {
  await page.clock.install({ time: new Date("2026-09-16T10:00:00+08:00") });
  await app.open();
  const locs = await app.locations();
  const { loc, at } = pickLoiter(locs);
  const override = page.locator("#override");

  await app.startGps(far(locs));
  await app.fix(at);                              // t = 0: timer starts
  await expect(override).toBeHidden();

  await page.clock.fastForward(60_000);
  await app.fix(at);                              // t = 60 s
  await expect(override).toBeHidden();

  await page.clock.fastForward(29_000);
  await app.fix(at);                              // t = 89 s
  await expect(override).toBeHidden();

  await page.clock.fastForward(2_000);
  await app.fix(at);                              // t = 91 s
  await expect(override).toBeVisible();
  await expect(app.reached()).toHaveText("0");    // still not opened by the engine

  await override.click();
  await expect(app.sheet()).toHaveClass(/\bup\b/);
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
  await expect(app.reached()).toHaveText("1");
});
