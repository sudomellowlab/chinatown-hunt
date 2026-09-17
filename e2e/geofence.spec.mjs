// Browser tests against the built dist/chinatown-hunt.html, driving the genuine
// navigator.geolocation.watchPosition path with Playwright's geolocation emulation.
// The emulator in the dev drawer is deliberately not used for positions.
import { test, expect, CEILING, offset, pickArrival, pickLoiter, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

/* ── tests ─────────────────────────────────────────────────────────────── */

test("a scripted approach opens the location only after the debounce", async ({ app }) => {
  await app.open();
  const locs = await app.locations();
  const { loc, approach } = pickArrival(locs);

  await app.startGps(far(locs));
  for (const p of approach) await app.fix(p);
  await expect(app.opened()).toHaveCount(0);

  // consecutiveFixes is 3: inside twice is not enough…
  await app.fix(loc);
  await app.fix(offset(loc, 2, 45));
  await expect(app.opened()).toHaveCount(0);
  await expect(app.sheet()).not.toHaveClass(/\bup\b/);
  await expect(app.pin(loc.id)).not.toHaveClass(/\b(active|reached)\b/);

  // …the third opens it.
  await app.fix(offset(loc, 2, 225));
  await expect(app.opened()).toHaveCount(1);
  await expect(app.pin(loc.id)).toHaveClass(/\bactive\b/);
});

test("fixes with accuracy above the ceiling open nothing", async ({ app, page }) => {
  await app.open();
  const locs = await app.locations();
  const { loc } = pickArrival(locs);

  await app.startGps(far(locs));
  for (let i = 0; i < 5; i++) await app.fix(loc, CEILING + 30);
  await expect(app.opened()).toHaveCount(0);
  await expect(app.sheet()).not.toHaveClass(/\bup\b/);

  // The rejections are visible in the fix log, with the reason.
  await app.openTools();
  await expect(page.locator("#log .rej")).toHaveCount(5);
  await expect(page.locator("#log .rej").first()).toContainText(`over ${CEILING}m ceiling`);
  await app.closeTools();

  // Accuracy exactly at the ceiling is accepted — and the rejected fixes didn't count toward the streak.
  await app.fix(loc, CEILING);
  await app.fix(loc, CEILING);
  await expect(app.opened()).toHaveCount(0);
  await app.fix(loc, CEILING);
  await expect(app.opened()).toHaveCount(1);
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
  await expect(app.opened()).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await expect(app.opened()).toHaveCount(1);
  await expect(app.pin(loc.id)).toHaveClass(/\bactive\b/);
  // Mid-location, a reload goes straight back to that location.
  await expect(app.sheet()).toHaveClass(/\bup\b/);
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
  await expect(page.locator("#target")).toHaveText(loc.name);
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
  await expect(app.opened()).toHaveCount(0);    // still not opened by the engine

  await override.click();
  await expect(app.sheet()).toHaveClass(/\bup\b/);
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
  await expect(app.opened()).toHaveCount(1);
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
  app.expectDialog("Location permission was refused. Allow location access for this site in your browser settings, then try again.");

  await app.openTools();
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
  await expect(app.opened()).toHaveCount(0);

  await app.openTools();
  await expect(page.locator("#ceilO")).toHaveText("20 m");
  await expect(page.locator("#log .rej").first()).toContainText("over 20m ceiling");
});

test("a participant's countdown carries on across a reload instead of restarting", async ({ app, page }) => {
  await app.open({ file: "play" });
  await app.begin(far(GAME.locations));
  await expect(page.locator("#clock")).toHaveText(/^(2:00:00|1:59:5\d)$/);

  // Pretend the game started ten minutes ago, then reload.
  await page.evaluate(() => {
    const k = "chinatown-hunt:chinatown-historical-hunt", d = JSON.parse(localStorage.getItem(k));
    d.startedAt = Date.now() - 10 * 60_000;
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload();
  await expect(page.locator("#clock")).toHaveText(/^1:(49:[0-5]\d|50:00)$/);
});

test("pins are teardrops whose tip marks the spot, inside a clearly shaded area that changes as the game goes on", async ({ app, page }) => {
  await app.open({ file: "play" });
  const loc = GAME.locations[0];
  const ringOf = id => page.locator(".leaflet-overlay-pane path").nth(GAME.locations.findIndex(l => l.id === id));
  const style = async id => ringOf(id).evaluate(p => ({ fill: p.getAttribute("fill"), op: +p.getAttribute("fill-opacity") }));

  // Every location starts shaded dark, strongly enough to see on a busy map.
  for (const l of GAME.locations) {
    const s = await style(l.id);
    expect(s.fill).toBe("#16202B");
    expect(s.op).toBeGreaterThanOrEqual(0.35);
  }
  await expect(page.locator(".pinnum")).toHaveCount(0);

  // The tip of the pin is the centre of its circle.
  const pin = await page.locator(`.pin[data-id="${loc.id}"]`).boundingBox();
  const ring = await ringOf(loc.id).boundingBox();
  expect(Math.abs(pin.x + pin.width / 2 - (ring.x + ring.width / 2))).toBeLessThan(1.5);
  expect(Math.abs(pin.y + 32 - (ring.y + ring.height / 2))).toBeLessThan(1.5);

  // Gold while open, green once finished.
  await app.begin(far(GAME.locations));
  for (let i = 0; i < 3; i++) await app.fix(offset(loc, 1, i * 120));
  expect((await style(loc.id)).fill).toBe("#8A6D2F");
  await expect(page.locator(`.pin[data-id="${loc.id}"]`)).toHaveClass(/\bactive\b/);
  await page.locator("#nextBtn").click();
  for (let i = 1; i < loc.tasks.length; i++) await page.locator("#nextBtn").click();
  await page.locator("#finishBtn").click();
  expect((await style(loc.id)).fill).toBe("#2E6B5E");
  await expect(page.locator(`.pin[data-id="${loc.id}"]`)).toHaveClass(/\breached\b/);
});
