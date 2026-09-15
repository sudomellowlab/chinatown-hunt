// Walk recorder, export and in-app replay, against the built file.
import { readFileSync } from "node:fs";
import { test, expect, offset, pickArrival, pickLoiter, far } from "./fixtures.mjs";

const CLEAN_SLATE = "Replay from a clean slate? This clears opened locations and streaks on this device.";
const FASTEST = 6;   // index of 120× in the speed slider

const openDrawer  = page => page.locator("#devbtn").click();
const closeDrawer = page => page.locator("#drawerclose").click();

async function downloadWalk(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#walkDownload").click()]);
  return { name: dl.suggestedFilename(), walk: JSON.parse(readFileSync(await dl.path(), "utf8")) };
}
async function loadWalk(page, walk, name = "walk.json") {
  await page.locator("#replayFile").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(walk)) });
}
async function setSpeed(page, index) {
  await page.locator("#replaySpeed").evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, index);
}

// Record a real-GPS walk that opens one location: 1 start fix, 3 approach fixes, 3 inside.
async function recordArrival(app, page) {
  await app.open();
  const locs = await app.locations();
  const { loc, approach } = pickArrival(locs);
  await app.startGps(far(locs));
  for (const p of approach) await app.fix(p);
  for (let i = 0; i < 3; i++) await app.fix(offset(loc, 1, i * 120));
  await expect(app.reached()).toHaveText("1");
  await page.locator("#sheetclose").click();           // back to the map, as a walker would
  return { locs, loc };
}

test("every real fix is recorded and downloads as a dated walk file", async ({ app, page }) => {
  const { locs, loc } = await recordArrival(app, page);

  await openDrawer(page);
  await expect(page.locator("#walkStatus")).toContainText("7 fixes recorded");
  await expect(page.locator("#walkStatus")).toContainText("real 7");

  const { name, walk } = await downloadWalk(page);
  expect(name).toMatch(/^chinatown-walk-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  expect(walk.format).toBe("chinatown-hunt-walk");
  expect(walk.cfg).toEqual({ radius: 25, accuracyCeiling: 50, consecutiveFixes: 3 });
  expect(walk.locations.map(l => l.id)).toEqual(locs.map(l => l.id));
  expect(walk.fixes).toHaveLength(7);
  for (const [i, f] of walk.fixes.entries()) {
    expect(Object.keys(f).sort()).toEqual(["accuracy", "lat", "lng", "source", "t"]);
    expect(f.source).toBe("real");
    if (i) expect(f.t).toBeGreaterThanOrEqual(walk.fixes[i - 1].t);
  }
  expect(Math.abs(walk.fixes.at(-1).lat - loc.lat)).toBeLessThan(2e-5);
});

test("the recording is saved every few seconds without a reload", async ({ app, page }) => {
  await page.clock.install();
  await app.open();
  const locs = await app.locations();
  await app.startGps(far(locs));
  await app.fix(offset(far(locs), 10, 0));
  await app.fix(offset(far(locs), 20, 0));

  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt-m1:walk") || "[]").length);
  await page.clock.fastForward(6000);
  await expect.poll(saved).toBe(3);
});

test("the recording survives a reload", async ({ app, page }) => {
  await app.open();
  const locs = await app.locations();
  await app.startGps(far(locs));
  await app.fix(offset(far(locs), 10, 0));

  await page.reload();                      // well inside the 5 s save interval: pagehide must save it
  await expect(page.locator(".pin")).toHaveCount(8);
  await openDrawer(page);
  await expect(page.locator("#walkStatus")).toContainText("2 fixes recorded");
  expect((await downloadWalk(page)).walk.fixes).toHaveLength(2);
});

test("a downloaded walk replays in-app and reopens the same location", async ({ app, page }) => {
  const { loc } = await recordArrival(app, page);
  await openDrawer(page);
  const { walk } = await downloadWalk(page);

  await loadWalk(page, walk);
  await expect(page.locator("#replayStatus")).toContainText("fix 0 of 7");
  await setSpeed(page, FASTEST);
  app.expectDialog(CLEAN_SLATE, { accept: true });
  await page.locator("#replayPlay").click();

  await expect(page.locator("#replayStatus")).toContainText("finished");
  await closeDrawer(page);
  await expect(app.reached()).toHaveText("1");
  await expect(app.pin(loc.id)).toHaveClass(/\breached\b/);
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
  await expect(page.locator("#srctxt")).toHaveText("replay 120×");
  await expect(page.locator("#fixcount")).toHaveText("14");

  // Replayed fixes are not added to the recording.
  await page.locator("#sheetclose").click();
  await openDrawer(page);
  await expect(page.locator("#walkStatus")).toContainText("7 fixes recorded");
});

test("replay keeps recorded time: a 95-second loiter makes the override available in a second or two", async ({ app, page }) => {
  await app.open();
  const locs = await app.locations();
  const { loc, at } = pickLoiter(locs);
  const t0 = Date.UTC(2026, 8, 16, 1, 0, 0);
  const walk = {
    format: "chinatown-hunt-walk", version: 1, locations: locs,
    fixes: Array.from({ length: 20 }, (_, i) => ({ t: t0 + i * 5000, lat: at.lat, lng: at.lng, accuracy: 8, source: "real" })),
  };

  await openDrawer(page);
  await loadWalk(page, walk);
  await setSpeed(page, FASTEST);
  const started = Date.now();
  await page.locator("#replayPlay").click();
  await expect(page.locator("#replayStatus")).toContainText("finished");
  await closeDrawer(page);

  await expect(page.locator("#override")).toBeVisible();
  await expect(app.reached()).toHaveText("0");
  expect(Date.now() - started, "95 s of recorded time should replay in a few real seconds").toBeLessThan(10_000);

  await page.locator("#override").click();
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
});

test("a file that isn't a walk is refused with a message", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  app.expectDialog("Couldn't load notes.json: not valid JSON.");
  await page.locator("#replayFile").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("shopping list") });
  await expect(page.locator("#replayStatus")).toHaveText("No walk loaded.");
  await expect(page.locator("#replayPlay")).toBeDisabled();
});
