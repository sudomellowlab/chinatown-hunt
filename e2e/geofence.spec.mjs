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
    let patchHtml = html => html;
    await context.route(`${ORIGIN}/**`, route =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: patchHtml(readFileSync(DIST, "utf8")) }));
    await context.route(/tile\.openstreetmap\.org/, route => route.abort());   // map tiles: noise, not under test
    await context.grantPermissions(["geolocation"], { origin: ORIGIN });

    // Count watchPosition errors as the app receives them, without changing what it receives.
    // Chromium's emulation delivers a POSITION_UNAVAILABLE (code 2) error immediately before every
    // setGeolocation() update, so every test here exercises transient-error handling for free.
    await page.addInitScript(() => {
      const geo = navigator.geolocation, watch = geo.watchPosition.bind(geo);
      window.__geoErrors = [];
      geo.watchPosition = (ok, err, opts) => watch(ok, e => { window.__geoErrors.push(e.code); err?.(e); }, opts);
    });

    // No alert may appear unless a test expects exactly that message.
    const dialogs = [], expectedDialogs = [];
    page.on("dialog", d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

    let fixes = 0, nudge = 0;
    const app = {
      // patch: edit the served HTML, e.g. to change GAME. Throws if the edit doesn't apply.
      async open({ patch } = {}) {
        if (patch) patchHtml = html => { const out = patch(html); if (out === html) throw new Error("patch did not apply"); return out; };
        await page.goto(APP);
        await expect(page.locator(".pin")).toHaveCount(8);
      },
      expectDialog(message) { expectedDialogs.push(message); },
      geoErrors: () => page.evaluate(() => window.__geoErrors),

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
    expect(dialogs, "no alerts other than the ones the test expects").toEqual(expectedDialogs);
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

/* ── regressions: GPS error handling, settings from GAME ────────────────── */

test("transient GPS errors neither alert nor knock the app off live GPS", async ({ app, page }) => {
  await app.open();
  const locs = await app.locations();
  const start = far(locs);

  await app.startGps(start);
  for (let i = 1; i <= 3; i++) await app.fix(offset(start, i * 5, 0));

  // Precondition: the app really did receive position-unavailable errors mid-watch.
  expect((await app.geoErrors()).filter(code => code === 2).length).toBeGreaterThanOrEqual(3);
  // …and handled them quietly: still live, and the fixture fails the test if any alert appeared.
  await expect(page.locator("#srctxt")).toHaveText("live GPS");
  await expect(page.locator("#srcdot")).toHaveClass(/\blive\b/);
});

test("refused location permission alerts once and stops GPS", async ({ app, page, context }) => {
  await context.clearPermissions();
  await app.open();
  app.expectDialog("Location permission was refused. Allow it in the browser's site settings, then tap Real GPS again.");

  await page.locator("#devbtn").click();
  await page.locator("#srcReal").click();
  await expect(page.locator("#srctxt")).toHaveText("no position");
  await expect.poll(() => app.geoErrors()).toEqual([1]);
});

test("engine settings come from GAME.defaults, not the drawer's slider positions", async ({ app, page }) => {
  // Serve a build whose GAME sets a 20 m ceiling; the drawer's HTML slider default is 50 m.
  await app.open({ patch: html => html.replace("accuracyCeiling: 50,", "accuracyCeiling: 20,") });
  const locs = await app.locations();
  const { loc } = pickArrival(locs);

  await app.startGps(far(locs));
  for (let i = 0; i < 3; i++) await app.fix(loc, 30);          // fine under 50 m, rejected under 20 m
  await expect(app.reached()).toHaveText("0");

  await page.locator("#devbtn").click();
  await expect(page.locator("#ceilO")).toHaveText("20 m");
  await expect(page.locator("#log .rej").first()).toContainText("over 20m ceiling");
});

test("the countdown carries on across a reload instead of restarting", async ({ app, page }) => {
  await app.open();
  await expect(page.locator("#clock")).toHaveText(/^(2:00:00|1:59:5\d)$/);

  // Pretend the game started ten minutes ago, then reload.
  await page.evaluate(() => {
    const k = "chinatown-hunt-m1", d = JSON.parse(localStorage.getItem(k));
    d.startedAt = Date.now() - 10 * 60_000;
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload();
  await expect(page.locator("#clock")).toHaveText(/^1:(49:[0-5]\d|50:00)$/);
});
