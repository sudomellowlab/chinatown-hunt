// Preview as participant: the admin file opened with ?preview in its own window. It must look
// like the participant game, use the draft, fake the location through the real GPS path, and
// keep its progress apart from the admin file's.
import { readFileSync } from "node:fs";
import { test, expect, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

const THK = GAME.locations.find(l => l.id === "thian-hock-keng");
let admin;
test.beforeEach(async ({ app }) => {
  admin = app;
  await app.open();
  await app.openTools();
});

async function openPreview(page) {
  const [pv] = await Promise.all([page.waitForEvent("popup"), page.locator("#previewGame").click()]);
  await pv.waitForLoadState("load");
  await expect(pv.locator(".pin")).toHaveCount(GAME.locations.length);
  pv.on("dialog", d => d.accept());
  return pv;
}

test("the preview shows the draft as participants see it, with a fake location", async ({ page }) => {
  await page.locator("#capTarget").selectOption(THK.id);
  await page.locator("#arrivalEdit").fill("Previewed arrival text.");
  const pv = await openPreview(page);

  // Looks like the participant game: start screen, no admin tools.
  await expect(pv).toHaveTitle(`${GAME.title} · Preview`);
  await expect(pv.locator("#startBtn")).toHaveText("Begin");
  await expect(pv.locator("#drawer")).toBeHidden();
  await expect(pv.locator("#devbtn")).toBeHidden();
  await expect(pv.locator("#previewbar")).toContainText("Tap Begin, then click the map");
  await pv.locator("#startBtn").click();
  await expect(pv.locator("#srctxt")).toHaveText("live GPS");
  await expect(pv.locator("#clock")).toHaveText(/^(2:00:00|1:59:5\d)$/);

  // Go to a location: it opens through the normal 3-fix check, with the draft's text.
  await pv.locator("#pvGo").selectOption(THK.id);
  await expect(pv.locator("#sheetname")).toHaveText(THK.name, { timeout: 8000 });
  await expect(pv.locator("#sheettext")).toHaveText("Previewed arrival text.");
  expect(+(await pv.locator("#fixcount").textContent())).toBeGreaterThanOrEqual(3);
  await pv.locator("#nextBtn").click();
  await expect(pv.locator("#sheetplace")).toHaveText(`challenge 1 of ${THK.tasks.length}`);
  await expect(pv.locator("#pvHint")).toHaveText("A location is open. Finish it to see the map again.");
  await expect(pv.locator("#previewbar"), "the preview bar stays above the full-screen location").toBeInViewport();

  // The admin file's own progress is untouched.
  await expect(page.locator(".pin.active, .pin.reached")).toHaveCount(0);
  const keys = await pv.evaluate(() => Object.keys(localStorage).filter(k => /^chinatown-hunt(-\w+)?:chinatown/.test(k)).sort());
  expect(keys).toContain("chinatown-hunt-preview:chinatown-historical-hunt");
});

test("clicking the map or a pin moves you; far from a location nothing opens", async ({ page }) => {
  const pv = await openPreview(page);
  await pv.locator("#startBtn").click();

  // Somewhere empty: the left edge of the map, below the preview bar and status strip.
  const box = await pv.locator("#map").boundingBox();
  await pv.mouse.click(box.x + 15, box.y + box.height * 0.35);
  await expect(pv.locator("#pvHint")).toHaveText("You're where you clicked. Click elsewhere to move.");
  await pv.waitForTimeout(3500);
  await expect(pv.locator(".pin.active")).toHaveCount(0);
  await expect(pv.locator("#metres")).not.toHaveText("—");

  // On a pin.
  await pv.locator(`.pin[data-id="${THK.id}"]`).click();
  await expect(pv.locator("#sheetname")).toHaveText(THK.name, { timeout: 8000 });
});

test("Skip to clues brings the clues screen forward; Restart goes back to the start screen", async ({ page }) => {
  const pv = await openPreview(page);
  await pv.locator("#startBtn").click();
  await pv.locator("#pvClues").click();
  await expect(pv.locator("#reveal")).toBeVisible();
  await expect(pv.locator("#clueList li")).toHaveCount(GAME.clues.length);
  await expect(pv.locator("#previewbar"), "the preview bar stays usable over the clues").toBeVisible();

  await pv.locator("#pvRestart").click();
  await pv.waitForLoadState("load");
  await expect(pv.locator("#startBtn")).toHaveText("Begin");
  await expect(pv.locator("#reveal")).toBeHidden();
});

test("Skip to clues before Begin explains why nothing happens", async ({ page }) => {
  const pv = await openPreview(page);
  const msg = pv.waitForEvent("dialog");
  await pv.locator("#pvClues").click();
  expect((await msg).message()).toBe("Tap Begin first: the clock starts then.");
  await expect(pv.locator("#reveal")).toBeHidden();
});

test("with a Google key, the preview's map requests come from this web address", async ({ app, page }) => {
  await page.locator("#mapKey").fill("AIzaTest-preview");
  await page.locator("#mapKeyApply").click();
  await expect(page.locator("#mapInfo")).toContainText("Google Maps is on");
  const referers = [];
  page.context().on("request", r => { if (r.url().startsWith("https://tile.googleapis.com/v1/2dtiles/")) referers.push(r.headers()["referer"] ?? ""); });
  const pv = await openPreview(page);
  await expect.poll(() => referers.length).toBeGreaterThan(0);
  expect(referers.every(r => r.startsWith("https://hunt.test/"))).toBe(true);
  await expect(pv.locator(".leaflet-control-attribution")).toContainText("Google Maps");
});

test("exported files contain no preview tools", async ({ page }) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  const html = readFileSync(await dl.path(), "utf8");
  for (const s of ["pvGo", "previewbar", "startPreview", "?preview", "chinatown-hunt-preview"]) expect(html).not.toContain(s);
  expect(readFileSync(new URL("../dist/chinatown-hunt.html", import.meta.url), "utf8")).not.toContain("pvGo");
});
