// Setting locations (POIs) by hand, against the built file. Admin work: runs in the
// "desktop" project (1440×900), where the panel docks beside the map.
import { test, expect, offset, far } from "./fixtures.mjs";
import { Engine } from "../src/engine.js";

const THK = "thian-hock-keng";
const CLUB = "club-street";

// Opening and closing the tools goes through the fixture, which copes with either state.
let tools;
test.beforeEach(({ app }) => { tools = app; });
const openDrawer  = () => tools.openTools();
const closeDrawer = () => tools.closeTools();
const select = (page, id) => page.locator("#capTarget").selectOption(id);
// Start placing and wait for the map to finish zooming to the pin, as a person would before clicking.
async function startPlacing(page) {
  await page.locator("#poiPlace").click();
  await expect(page.locator("#poibar")).toBeVisible();
  await expect(page.locator(".leaflet-zoom-anim")).toHaveCount(0);
  await settled(page, await page.locator("#capTarget").inputValue());
}
// Wait until a pin has stopped moving on screen (the map may still be panning or zooming to it).
async function settled(page, id) {
  const pin = page.locator(`.pin[data-id="${id}"]`);
  let last = null;
  await expect.poll(async () => {
    const b = await pin.boundingBox();
    const same = last && Math.abs(b.x - last.x) < 0.5 && Math.abs(b.y - last.y) < 0.5;
    last = b;
    return same;
  }, { intervals: [100] }).toBe(true);
}
// Centre of the visible map, in page pixels.
async function mapCentre(page) {
  const b = await page.locator("#map").boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// The app's own export of its locations (drawer must be open).
async function exported(page) {
  await page.locator("details.more").evaluate(d => { d.open = true; });
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

test("a location placed by clicking the map opens there, and no longer at its old spot", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const before = await exported(page);
  const old = find(before, THK);

  await select(page, THK);
  await startPlacing(page);
  await expect(page.locator("#poibar")).toBeVisible();
  await expect(page.locator("#poibarText")).toHaveText(`Placing ${old.name} · radius ${old.radius} m`);

  // The map centres on the pin at zoom 18 (~0.6 m per pixel). Click 150 px away in a
  // direction that lands clear of the other geofences.
  const c = await mapCentre(page);
  let placed;
  for (const [dx, dy] of [[-150, 0], [0, -150], [150, 0], [0, 150]]) {
    await page.mouse.click(c.x + dx, c.y + dy);
    await page.locator("#poiDone").click();
    placed = find(await exported(page), THK);
    if (clearOfOthers(placed, before, THK, 10)) break;
    await startPlacing(page);
  }
  expect(metres(old, placed), "click 150 px from the pin at zoom 18").toBeGreaterThan(80);
  expect(metres(old, placed)).toBeLessThan(100);
  await expect(page.locator("#poiInfo")).toContainText("moved");
  await expect(page.locator("#poibar")).toBeHidden();
  await closeDrawer(page);

  // Real GPS: standing at the old spot does nothing; walking to the new one opens it.
  await app.startGps(far(before));
  if (clearOfOthers(old, before, THK)) {
    for (let i = 0; i < 3; i++) await app.fix(old);
    await expect(app.opened()).toHaveCount(0);
  }
  for (let i = 0; i < 3; i++) await app.fix(placed);
  await expect(app.opened()).toHaveCount(1);
  await expect(page.locator("#sheetname")).toHaveText(old.name);
});

test("dragging the pin moves the location", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const old = find(await exported(page), THK);
  await select(page, THK);
  await startPlacing(page);
  await settled(page, THK);

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
  await expect(page.locator("#poiInfo")).toContainText(`${lat.toFixed(6)}, ${lng.toFixed(6)} · radius 40 m · moved`);
  expect(find(await exported(page), CLUB)).toMatchObject({ lat, lng, radius: 40 });
  await closeDrawer(page);

  // 45 m out stays shut with a 40 m radius; 35 m out opens.
  const target = { lat, lng };
  await app.startGps(far(locs));
  for (let i = 0; i < 3; i++) await app.fix(offset(target, 45, 90));
  await expect(app.opened()).toHaveCount(0);
  for (let i = 0; i < 3; i++) await app.fix(offset(target, 35, 90));
  await expect(app.opened()).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await openDrawer(page);
  await select(page, CLUB);
  await expect(page.locator("#poiInfo")).toContainText(`${lat.toFixed(6)}, ${lng.toFixed(6)} · radius 40 m · moved`);
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
  await expect(page.locator("#poiInfo")).toContainText("as in the default game");
  await expect(page.locator("#poiRevert")).toBeDisabled();
  await expect(page.locator("#capRadO")).toHaveText(`${original.radius} m`);
});

test("your setup is kept when the default game in the code changes", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  await select(page, THK);
  await pasteCoords(page, "1.281234, 103.847654");
  await select(page, CLUB);
  await pasteCoords(page, "1.281500, 103.845500");

  // A new build whose default game has different coordinates for Thian Hock Keng.
  await app.open({ patch: html => html.replace("lat:1.28092, lng:103.84760", "lat:1.28100, lng:103.84770") });
  await openDrawer(page);
  const locs = await exported(page);
  expect(find(locs, THK)).toMatchObject({ lat: 1.281234, lng: 103.847654 });   // the admin's work wins
  expect(find(locs, CLUB)).toMatchObject({ lat: 1.2815, lng: 103.8455 });
});

test("location moves saved by the previous version are carried into your setup", async ({ app, page }) => {
  await app.open();
  await page.evaluate(() => localStorage.setItem("chinatown-hunt-m1:poi", JSON.stringify({
    "thian-hock-keng": { base: { lat: 1.28092, lng: 103.8476, radius: 22 }, value: { lat: 1.2811, lng: 103.8479, radius: 30 } },
  })));
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await openDrawer(page);
  expect(find(await exported(page), THK)).toMatchObject({ lat: 1.2811, lng: 103.8479, radius: 30 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt-m1:draft"))?.game?.locations?.length)).toBe(8);
});

test("coordinates saved by older builds no longer override GAME", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const original = find(await exported(page), THK);

  // The old progress format stored every location's coordinates alongside progress.
  await page.evaluate(id => {
    const d = { opened: [], startedAt: Date.now(), locations: [{ id, lat: 1.3, lng: 103.9, radius: 70 }] };
    localStorage.setItem("chinatown-hunt-m1", JSON.stringify(d));
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

test("on a computer the panel sits beside the map and placing never hides it", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  await expect(page.locator("#drawer")).toBeInViewport({ ratio: 1 });        // finished sliding in
  const map = await page.locator("#map").boundingBox(), panel = await page.locator("#drawer").boundingBox();
  const vw = page.viewportSize().width;
  expect(panel.x + panel.width).toBeCloseTo(vw, 0);
  expect(map.x + map.width, "map ends where the panel starts").toBeLessThanOrEqual(panel.x + 1);
  expect(map.width).toBeGreaterThan(900);
  await expect(page.locator("#hud")).toBeInViewport();
  await expect(page.locator("#devbtn")).toBeHidden();

  // Actions that need the map leave the panel open.
  await select(page, THK);
  await startPlacing(page);
  await expect(page.locator("#drawer")).toBeInViewport();
  const poibar = await page.locator("#poibar").boundingBox();
  expect(poibar.x + poibar.width, "the placing bar sits over the map, not the panel").toBeLessThanOrEqual(panel.x);

  // Esc finishes placing; the panel is still there.
  await page.keyboard.press("Escape");
  await expect(page.locator("#poibar")).toBeHidden();
  await expect(page.locator("#drawer")).toBeInViewport();

  await page.locator("#jump").selectOption(CLUB);
  await expect(page.locator("#drawer")).toBeInViewport();

  // Closing the panel gives the map the whole window back.
  await closeDrawer(page);
  await expect.poll(async () => (await page.locator("#map").boundingBox()).width).toBeCloseTo(vw, 0);
});

test("clicking a pin selects it, and Enter applies pasted coordinates", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  await select(page, CLUB);
  await expect(page.locator(".leaflet-zoom-anim")).toHaveCount(0);

  await page.locator(`.pin[data-id="${THK}"]`).click();
  await expect(page.locator("#capTarget")).toHaveValue(THK);
  await expect(page.locator("#poiInfo")).toContainText("radius 22 m");

  await page.locator("#poiCoords").fill("1.281111, 103.847777");
  await page.locator("#poiCoords").press("Enter");
  expect(find(await exported(page), THK)).toMatchObject({ lat: 1.281111, lng: 103.847777 });
  await expect(page.locator("#poiCoords")).toHaveValue("");
});

// Drag a location's pin by (dx, dy) pixels with the mouse, in small steps like a person would.
async function dragPin(page, id, dx, dy) {
  await settled(page, id);
  const box = await page.locator(`.pin[data-id="${id}"]`).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + dx * i / 10, y + dy * i / 10);
  await page.mouse.up();
}

test("with the panel open, any pin can be dragged straight away", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  await select(page, CLUB);                                   // a different location is selected
  await expect(page.locator(".leaflet-zoom-anim")).toHaveCount(0);
  const old = find(await exported(page), THK);
  const ringBefore = await page.locator("path.leaflet-interactive").nth(1).boundingBox();

  await dragPin(page, THK, 0, -100);                          // ~60 m north at zoom 18, no "Place on map"

  await expect(page.locator("#capTarget")).toHaveValue(THK);  // grabbing a pin selects it
  const moved = find(await exported(page), THK);
  expect(moved.lat).toBeGreaterThan(old.lat);
  expect(metres(old, moved)).toBeGreaterThan(50);
  expect(metres(old, moved)).toBeLessThan(70);
  expect(Math.abs(moved.lng - old.lng) * 111_195).toBeLessThan(5);
  await expect(page.locator("#poiInfo")).toContainText("moved");
  const ringAfter = await page.locator("path.leaflet-interactive").nth(1).boundingBox();
  expect(ringAfter.y, "the geofence circle moved with the pin").toBeLessThan(ringBefore.y - 80);

  // …and the move survives a reload.
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await openDrawer(page);
  expect(find(await exported(page), THK)).toMatchObject({ lat: moved.lat, lng: moved.lng });
});

test("with the tools closed, dragging a pin just pans the map", async ({ app, page }) => {
  await app.open();
  await openDrawer(page);
  const before = await exported(page);
  await closeDrawer(page);
  await expect.poll(async () => (await page.locator("#map").boundingBox()).width).toBe(page.viewportSize().width);

  await dragPin(page, THK, 0, -100);

  await openDrawer(page);
  expect(await exported(page)).toEqual(before);
});
