// The base map: Google's map (Map Tiles API) when the game has a key, OpenStreetMap otherwise.
// Google is faked in the fixtures: keys starting "bad" are refused, "notiles" get no tiles.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";
import { Pack } from "../src/pack.js";

const PLAY_FILE = new URL("../dist/chinatown-hunt.html", import.meta.url);
const KEY = "AIzaTest-key-123";
function playHtml(key) {
  const game = structuredClone(GAME);
  game.map = { googleKey: key };
  return readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);
}
const credit = page => page.locator(".leaflet-control-attribution");
const typeButtons = page => page.locator(".maptype button");
// Tile images currently on the map (the browser may reuse cached ones without a new request).
const tileSrcs = page => page.locator("#map img.leaflet-tile").evaluateAll(imgs => imgs.map(i => i.src));

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "participant view");

  test("with a key, the map is Google's: one session, tiles with that session, Google credit", async ({ app, page }) => {
    await app.open({ file: "play", html: playHtml(KEY) });
    await expect.poll(() => app.google.tiles.length).toBeGreaterThan(3);
    expect(app.google.sessions).toEqual([{ key: KEY, mapType: "roadmap", language: "en-GB", region: "SG" }]);
    expect(new Set(app.google.tiles.map(t => t.session))).toEqual(new Set(["sess-roadmap-1"]));
    expect(app.google.tiles.every(t => t.key === KEY && /^\/v1\/2dtiles\/\d+\/\d+\/\d+$/.test(t.path))).toBe(true);
    expect(app.osm.requests, "no OpenStreetMap tiles").toBe(0);

    await expect(credit(page)).toContainText("Google Maps");
    await expect(credit(page)).toContainText("Map data ©2026 Google");
    await expect(credit(page)).not.toContainText("OpenStreetMap");
    await expect(typeButtons(page)).toHaveText(["Map", "Satellite"]);
  });

  test("the session is reused after a reload rather than requested again", async ({ app, page }) => {
    await app.open({ file: "play", html: playHtml(KEY) });
    await expect.poll(() => app.google.tiles.length).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator(".pin")).toHaveCount(8);
    await expect.poll(async () => (await tileSrcs(page)).length).toBeGreaterThan(0);
    expect((await tileSrcs(page)).every(src => src.includes("session=sess-roadmap-1"))).toBe(true);
    expect(app.google.sessions).toHaveLength(1);
  });

  test("the copyright follows the map as it moves", async ({ app, page }) => {
    await app.open({ file: "play", html: playHtml(KEY) });
    await app.begin(far(GAME.locations));
    await expect(credit(page)).toContainText("Map data ©2026 Google");
    const calls = app.google.viewports;
    app.google.copyright = "Map data ©2026 Google, Another Provider";
    await page.locator(".leaflet-control-zoom-out").click();        // moving the map asks Google again
    await expect(credit(page)).toContainText("Another Provider");
    expect(app.google.viewports).toBe(calls + 1);
  });

  test("Satellite switches to Google's satellite map, and the choice is remembered", async ({ app, page }) => {
    await app.open({ file: "play", html: playHtml(KEY) });
    await app.begin(far(GAME.locations));
    await expect(typeButtons(page).first()).toHaveAttribute("aria-pressed", "true");
    await typeButtons(page).last().click();
    await expect(typeButtons(page).last()).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => app.google.sessions.map(s => s.mapType)).toEqual(["roadmap", "satellite"]);
    await expect.poll(() => app.google.tiles.some(t => t.session === "sess-satellite-2")).toBe(true);

    await page.reload();
    await expect(typeButtons(page).last()).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => { const t = await tileSrcs(page); return t.length > 0 && t.every(src => src.includes("sess-satellite-2")); }).toBe(true);
    expect(app.google.sessions, "both sessions reused").toHaveLength(2);

    await page.locator("#startBtn").click();
    await typeButtons(page).first().click();
    await expect.poll(async () => { const t = await tileSrcs(page); return t.length > 0 && t.every(src => src.includes("sess-roadmap-1")); }).toBe(true);
    expect(app.google.sessions).toHaveLength(2);
  });

  test("a refused key falls back to OpenStreetMap quietly, and the game still works", async ({ app, page }) => {
    await app.open({ file: "play", html: playHtml("bad-key") });
    await expect.poll(() => app.osm.requests).toBeGreaterThan(0);
    expect(app.google.tiles).toEqual([]);
    await expect(credit(page)).toContainText("OpenStreetMap");
    await expect(credit(page)).not.toContainText("Google");
    await expect(typeButtons(page)).toHaveCount(0);
    await app.begin(far(GAME.locations));                          // no alert, GPS works (the fixture fails on any alert)
  });

  test("a key whose tiles are refused also falls back", async ({ app, page }) => {
    await app.open({ file: "play", html: playHtml("notiles-key") });
    await expect.poll(() => app.osm.requests).toBeGreaterThan(0);
    await expect(credit(page)).toContainText("OpenStreetMap");
    await expect(typeButtons(page)).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes("gsession")))).toEqual([]);
  });

  test("without a key, the map is OpenStreetMap and Google is never contacted", async ({ app, page }) => {
    await app.open({ file: "play" });
    await expect.poll(() => app.osm.requests).toBeGreaterThan(0);
    expect(app.google.sessions).toEqual([]);
    await expect(credit(page)).toContainText("OpenStreetMap");
  });
});

test.describe("in the admin panel", () => {
  test.skip(({ isMobile }) => isMobile, "admin view");

  test("paste a key: the map switches to Google at once, and an exported file uses it on a phone", async ({ app, page, browser }) => {
    await app.open();
    await app.openTools();
    await expect(page.locator("#mapInfo")).toHaveText("No key: the map uses OpenStreetMap. That's fine for testing, but not allowed for paid events.");
    await expect(page.locator("#exportInfo")).toContainText("this file will show OpenStreetMap, not Google Maps");

    await page.locator("#mapKey").fill(KEY);
    await page.locator("#mapKey").press("Enter");
    await expect(page.locator("#mapInfo")).toHaveText("Google Maps is on (map view). Teams will see Google's map.");
    await expect(page.locator("#mapInfo")).not.toHaveClass(/\bbad\b/);
    await expect.poll(() => app.google.tiles.length).toBeGreaterThan(0);
    await expect(page.locator("#exportInfo")).not.toContainText("OpenStreetMap");

    // Saved with the draft.
    await page.reload();
    await expect(page.locator(".pin")).toHaveCount(8);
    await app.openTools();
    await expect(page.locator("#mapKey")).toHaveValue(KEY);
    await expect(page.locator("#mapInfo")).toContainText("Google Maps is on");

    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
    const html = readFileSync(await dl.path(), "utf8");
    expect(html, "the key isn't readable in the file").not.toContain(KEY);

    const phone = await browser.newContext({ ...devices["Pixel 7"] });
    try {
      const phonePage = await phone.newPage();
      const { app: player, done } = await createApp({ page: phonePage, context: phone });
      await player.open({ html });
      await expect.poll(() => player.google.tiles.length).toBeGreaterThan(0);
      expect(player.google.sessions[0].key).toBe(KEY);
      expect(player.osm.requests).toBe(0);
      done();
    } finally {
      await phone.close();
    }
  });

  test("a refused key says why in the panel and the map stays usable", async ({ app, page }) => {
    await app.open();
    await app.openTools();
    await page.locator("#mapKey").fill("bad-key");
    await page.locator("#mapKeyApply").click();
    await expect(page.locator("#mapInfo")).toHaveText("Using OpenStreetMap because Google didn't work: Google refused the key (403). Check it, and that its restrictions allow this website and the Map Tiles API.");
    await expect(page.locator("#mapInfo")).toHaveClass(/\bbad\b/);
    await expect(page.locator("#exportGame"), "a warning, not a block").toBeEnabled();

    // Fixing it clears the warning.
    await page.locator("#mapKey").fill(KEY);
    await page.locator("#mapKeyApply").click();
    await expect(page.locator("#mapInfo")).toContainText("Google Maps is on");
  });

  test("clearing the key goes back to OpenStreetMap", async ({ app, page }) => {
    await app.open();
    await app.openTools();
    await page.locator("#mapKey").fill(KEY);
    await page.locator("#mapKeyApply").click();
    await expect(page.locator("#mapInfo")).toContainText("Google Maps is on");
    await page.locator("#mapKey").fill("");
    await page.locator("#mapKeyApply").click();
    await expect(page.locator("#mapInfo")).toContainText("No key");
    await expect.poll(async () => { const t = await tileSrcs(page); return t.length > 0 && t.every(src => src.includes("openstreetmap")); }).toBe(true);
    await expect(page.locator(".maptype")).toHaveCount(0);
  });
});
