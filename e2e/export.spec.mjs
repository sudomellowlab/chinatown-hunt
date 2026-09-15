// Export game file: set up in the admin file on a computer, play the exported file on a phone.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, offset, far } from "./fixtures.mjs";
import { Engine } from "../src/engine.js";

const THK = "thian-hock-keng";
const find = (locs, id) => locs.find(l => l.id === id);

async function exportGame(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return { name: dl.suggestedFilename(), html: readFileSync(await dl.path(), "utf8") };
}

test("the exported file plays the game as set up in the admin panel, on a phone", async ({ app, page, browser }) => {
  // ── Admin, on a computer: move Thian Hock Keng somewhere new and widen its radius.
  await app.open();
  const locs = await app.locations();
  const spot = offset(locs[0], 400, 200);
  const lat = +spot.lat.toFixed(6), lng = +spot.lng.toFixed(6);
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK);
  await page.locator("#poiCoords").fill(`${lat}, ${lng}`);
  await page.locator("#poiCoords").press("Enter");
  await page.locator("#capRad").evaluate(el => { el.value = "35"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(page.locator("#exportInfo")).toContainText("8 locations, 1 moved from the default");

  const { name, html } = await exportGame(page);
  expect(name).toBe("chinatown-hunt.html");
  expect(html).toContain('data-build="play"');
  for (const secret of ["Thian Hock Keng", "Heavenly Happiness", String(lat), String(lng)]) expect(html).not.toContain(secret);
  for (const tool of ['id="drawer"', 'id="devbtn"', "setPoi", "Walk.record"]) expect(html).not.toContain(tool);

  // ── Participant, on a phone, with the exported file.
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const phonePage = await phone.newPage();
    const { app: player, done } = await createApp({ page: phonePage, context: phone });
    await player.open({ html, query: "?dev=1" });                 // ?dev=1 does nothing in this file
    await expect(phonePage.locator("#devbtn")).toHaveCount(0);
    await expect(phonePage.locator("#startBtn")).toHaveText("Begin");

    await player.begin(far(locs));
    // Old spot: nothing. New spot, 30 m out (inside the new 35 m radius): opens, with its name.
    const old = find(locs, THK);
    const clearOfOthers = locs.filter(l => l.id !== THK).every(l => Engine.haversine(old.lat, old.lng, l.lat, l.lng) > l.radius + 5);
    if (clearOfOthers) {
      for (let i = 0; i < 3; i++) await player.fix(old);
      await expect(phonePage.locator("#reached")).toHaveText("0");
    }
    for (let i = 0; i < 3; i++) await player.fix(offset({ lat, lng }, 30, 90));
    await expect(phonePage.locator("#reached")).toHaveText("1");
    await expect(phonePage.locator("#sheetname")).toHaveText(old.name);
    done();
  } finally {
    await phone.close();
  }
});

test("each export scrambles differently, and the admin file keeps working afterwards", async ({ app, page }) => {
  await app.open();
  await app.openTools();
  const a = (await exportGame(page)).html, b = (await exportGame(page)).html;
  expect(a).not.toEqual(b);
  await expect(page.locator("#drawer")).toBeInViewport();
  await expect(page.locator(".pin")).toHaveCount(8);
});
