// Browser tests against the built dist/chinatown-hunt.html, driving the genuine
// navigator.geolocation.watchPosition path with Playwright's geolocation emulation.
// The emulator in the dev drawer is deliberately not used for positions.
import { test, expect, CEILING, offset, pickArrival, pickLoiter, far } from "./fixtures.mjs";

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
  // With no position yet after the reload, the HUD must not claim everything is done.
  await expect(page.locator("#target")).toHaveText("—");
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
