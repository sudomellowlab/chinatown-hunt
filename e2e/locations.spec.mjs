// Setting locations (POIs) by hand in the dev drawer, against the built file.
import { test, expect, offset, far } from "./fixtures.mjs";
import { Engine } from "../src/engine.js";

const THK = "thian-hock-keng";
const CLUB = "club-street";

const openDrawer  = page => page.locator("#devbtn").click();
const closeDrawer = page => page.locator("#drawerclose").click();
const select = (page, id) => page.locator("#capTarget").selectOption(id);
// Start placing and wait for the drawer to finish sliding away, as a person would before tapping the map.
async function startPlacing(page) {
  await page.locator("#poiPlace").click();
  await expect(page.locator("#drawer")).not.toBeInViewport();
}

// The app's own export of its locations (drawer must be open).
async function exported(page) {
  await page.locator("#capExport").click();
  return JSON.parse(await page.locator("#capOut").inputValue());
}
const find = (locs, id) => locs.find(l => l.id === id);
const metres = (a, b) => Engine.haversine(a.lat, a.lng, b.lat, b.lng);
// True if p is clearly outside every location's geofence except `exceptId`.
const clearOfOthers = (p, locs, exceptId, margin = 5) =>
  locs.filter(l => l.id !== exceptId).every(l => metres(p, l) > l.radius + margin);

async function setRadius(page, m) {
  await page.locator("#capRad").evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, m);
}
async function pasteCoords(page, text) {
  await page.locator("#poiCoords").fill(text);
  await page.locator("#poiApply").click();
}

test("a location placed by tapping the map opens there, and no longer at its old spot", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const before = await exported(page);
  const old = find(before, THK);

  await select(page, THK);
  await startPlacing(page);
  await expect(page.locator("#poibar")).toBeVisible();
  await expect(page.locator("#poibarText")).toHaveText(`Placing ${old.name} · radius ${old.radius} m`);

  // The map centres on the pin at zoom 18 (~0.6 m per pixel). Tap 150 px away in a
  // direction that lands clear of the other geofences.
  const { width, height } = page.viewportSize();
  let placed;
  for (const [dx, dy] of [[-150, 0], [0, -150], [150, 0], [0, 150]]) {
    await page.mouse.click(width / 2 + dx, height / 2 + dy);
    await page.locator("#poiDone").click();
    placed = find(await exported(page), THK);
    if (clearOfOthers(placed, before, THK, 10)) break;
    await startPlacing(page);
  }
  expect(metres(old, placed), "tap 150 px from the pin at zoom 18").toBeGreaterThan(80);
  expect(metres(old, placed)).toBeLessThan(100);
  await expect(page.locator("#poiInfo")).toContainText("edited on this device");
  await expect(page.locator("#poibar")).toBeHidden();
  await closeDrawer(page);

  // Real GPS: standing at the old spot does nothing; walking to the new one opens it.
  await app.startGps(far(before));
  if (clearOfOthers(old, before, THK)) {
    for (let i = 0; i < 3; i++) await app.fix(old);
    await expect(app.reached()).toHaveText("0");
  }
  for (let i = 0; i < 3; i++) await app.fix(placed);
  await expect(app.reached()).toHaveText("1");
  await expect(page.locator("#sheetname")).toHaveText(old.name);
});

test("dragging the pin moves the location", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const old = find(await exported(page), THK);
  await select(page, THK);
  await startPlacing(page);

  const pin = page.locator(`.pin[data-id="${THK}"]`);
  const box = await pin.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 12, y);      // 120 px east, in steps
  await page.mouse.up();

  await page.locator("#poiDone").click();
  const moved = find(await exported(page), THK);
  expect(metres(old, moved), "120 px at zoom 18 is ~72 m").toBeGreaterThan(60);
  expect(metres(old, moved)).toBeLessThan(85);
  expect(moved.lng).toBeGreaterThan(old.lng);
  expect(Math.abs(moved.lat - old.lat) * 111_195).toBeLessThan(3);
});

test("pasted coordinates and the radius slider set the geofence, and survive a reload", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const locs = await exported(page);
  // A spot well away from every other location.
  const spot = offset(locs[0], 400, 200);
  const lat = +spot.lat.toFixed(6), lng = +spot.lng.toFixed(6);

  await select(page, CLUB);
  await pasteCoords(page, `https://www.google.com/maps/place/Somewhere/@1.2,103.8,17z/data=!3m1!4b1!4m6!3m5!8m2!3d${lat}!4d${lng}`);
  await setRadius(page, 40);
  await expect(page.locator("#poiInfo")).toContainText(`${lat.toFixed(6)}, ${lng.toFixed(6)} · radius 40 m · edited on this device`);
  expect(find(await exported(page), CLUB)).toMatchObject({ lat, lng, radius: 40 });
  await closeDrawer(page);

  // 45 m out stays shut with a 40 m radius; 35 m out opens.
  const target = { lat, lng };
  await app.startGps(far(locs));
  for (let i = 0; i < 3; i++) await app.fix(offset(target, 45, 90));
  await expect(app.reached()).toHaveText("0");
  for (let i = 0; i < 3; i++) await app.fix(offset(target, 35, 90));
  await expect(app.reached()).toHaveText("1");

  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await openDrawer(page);
  await select(page, CLUB);
  await expect(page.locator("#poiInfo")).toContainText(`${lat.toFixed(6)}, ${lng.toFixed(6)} · radius 40 m · edited on this device`);
  expect(find(await exported(page), CLUB)).toMatchObject({ lat, lng, radius: 40 });
});

test("Revert puts a location back to GAME's coordinates", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const original = find(await exported(page), THK);
  await select(page, THK);
  await expect(page.locator("#poiRevert")).toBeDisabled();

  await pasteCoords(page, "1.281234, 103.847654");
  await setRadius(page, 33);
  await expect(page.locator("#poiRevert")).toBeEnabled();

  await page.locator("#poiRevert").click();
  expect(find(await exported(page), THK)).toEqual(original);
  await expect(page.locator("#poiInfo")).toContainText("as in GAME");
  await expect(page.locator("#poiRevert")).toBeDisabled();
  await expect(page.locator("#capRadO")).toHaveText(`${original.radius} m`);
});

test("edits are dropped once GAME's coordinates change, so a phone never overrides the code", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  await select(page, THK);
  await pasteCoords(page, "1.281234, 103.847654");
  await select(page, CLUB);
  await pasteCoords(page, "1.281500, 103.845500");

  // Deploy a build where Thian Hock Keng has new coordinates in GAME. Club Street is unchanged.
  await app.open({ patch: html => html.replace("lat:1.28092, lng:103.84760", "lat:1.28100, lng:103.84770") });
  await openDrawer(page);
  const locs = await exported(page);
  expect(find(locs, THK)).toMatchObject({ lat: 1.281, lng: 103.8477 });       // GAME wins
  expect(find(locs, CLUB)).toMatchObject({ lat: 1.2815, lng: 103.8455 });     // untouched edit still applies
  await expect(page.locator("#poiInfo")).toContainText("Dropped edits for Thian Hock Keng Temple");
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("chinatown-hunt-m1:poi"))))).toEqual([CLUB]);
});

test("coordinates saved by older builds no longer override GAME", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const original = find(await exported(page), THK);

  // The old progress format stored every location's coordinates alongside progress.
  await page.evaluate(id => {
    const k = "chinatown-hunt-m1", d = JSON.parse(localStorage.getItem(k));
    d.locations = [{ id, lat: 1.3, lng: 103.9, radius: 70 }];
    localStorage.setItem(k, JSON.stringify(d));
  }, THK);
  await page.reload();
  await openDrawer(page);
  expect(find(await exported(page), THK)).toEqual(original);
});

test("text that isn't coordinates is refused with a message", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const before = await exported(page);
  app.expectDialog("Couldn't read those coordinates: expected decimal coordinates like 1.28092, 103.84760.");
  await pasteCoords(page, "Thian Hock Keng");
  expect(await exported(page)).toEqual(before);
});
