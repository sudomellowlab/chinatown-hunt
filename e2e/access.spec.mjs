// Who gets which tools, and how participants start. Phone-sized.
import { readFileSync } from "node:fs";
import { test, expect, offset, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

const PLAY_FILE = new URL("../dist/chinatown-hunt.html", import.meta.url);

test("the admin file shows its tools straight away, no link parameter needed", async ({ app, page }) => {
  await app.open();
  await expect(page.locator("#devbtn")).toBeVisible();
  await expect(page.locator("#devbanner")).toBeVisible();
  await expect(page.locator("#start")).toBeHidden();
  await app.openTools();
  await expect(page.locator("#exportGame")).toBeVisible();
});

test("the participant file has no admin tools, even with ?dev=1", async ({ app, page }) => {
  await app.open({ file: "play", query: "?dev=1" });
  for (const id of ["devbtn", "devbanner", "drawer", "poibar"]) await expect(page.locator(`#${id}`)).toHaveCount(0);

  // Not hidden but absent: none of the admin code is in the file.
  const html = readFileSync(PLAY_FILE, "utf8");
  for (const code of ["setPoi", "Walk.record", "stepReplay", "exportGame", "Poi.parseCoords"]) expect(html).not.toContain(code);
});

test("the participant file's source gives away no game content", async () => {
  const html = readFileSync(PLAY_FILE, "utf8");
  for (const l of GAME.locations) {
    expect(html).not.toContain(l.name);
    expect(html).not.toContain(l.arrivalText);
    expect(html).not.toContain(String(l.lat));
    expect(html).not.toContain(String(l.lng));
  }
  expect(html).toMatch(/Pack\.open\("cth1\./);
});

test("participants start with Begin, which is the only thing that asks for location", async ({ app, page }) => {
  await app.open({ file: "play" });
  await expect(page.locator("#start")).toBeVisible();
  await expect(page.locator("#startTitle")).toHaveText(GAME.title);
  await expect(page.locator("#startBtn")).toHaveText("Begin");
  await expect(page.locator("#clock")).toHaveText("2:00:00");
  expect(await app.geoWatches(), "no location request before Begin").toBe(0);
  await page.waitForTimeout(1500);
  await expect(page.locator("#clock"), "the clock doesn't run before Begin").toHaveText("2:00:00");

  const start = far(GAME.locations);
  await app.begin(start);
  expect(await app.geoWatches()).toBe(1);
  await expect(page.locator("#clock")).toHaveText(/^1:59:5\d$/, { timeout: 3000 });
});

test("a participant who reloads sees Continue and keeps their progress", async ({ app, page }) => {
  await app.open({ file: "play" });
  const loc = GAME.locations[0];
  await app.begin(far(GAME.locations));
  for (let i = 0; i < 3; i++) await app.fix(offset(loc, 1, i * 120));
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
  await page.locator("#stageBtn").click();                        // start the challenges
  await page.locator(".opt").nth(loc.tasks[0].answer).click();
  await page.locator("#stageBtn").click();                        // submit
  await expect(page.locator("#sheetplace")).toHaveText(`challenge 2 of ${loc.tasks.length}`);

  await page.reload();
  await expect(page.locator("#start")).toBeVisible();
  await expect(page.locator("#startBtn")).toHaveText("Continue");
  await expect(page.locator(`.pin[data-id="${loc.id}"]`)).toHaveClass(/\bactive\b/);
  expect(await app.geoWatches(), "no location request before Continue").toBe(0);

  await app.begin(far(GAME.locations));
  await expect(page.locator("#clock")).not.toHaveText("2:00:00");
});

test("a participant who refuses location is told how to fix it and can try again", async ({ app, page, context }) => {
  await context.clearPermissions();
  await app.open({ file: "play" });
  app.expectDialog("Location permission was refused. Allow location access for this site in your browser settings, then try again.");
  await page.locator("#startBtn").click();
  await expect(page.locator("#start")).toBeVisible();
  await expect(page.locator("#startBtn")).toHaveText("Continue");
});
