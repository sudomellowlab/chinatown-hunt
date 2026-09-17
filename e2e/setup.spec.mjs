// Setting up the game itself on a computer: title and wording, and adding, renaming,
// reordering and deleting locations. Checked end to end on a phone with the exported file.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, offset, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

let admin;
test.beforeEach(async ({ app }) => {
  admin = app;
  await app.open();
  await app.openTools();
});

const optionTexts = page => page.locator("#capTarget option").allTextContents();
const pinNumbers = page => page.locator(".pin").evaluateAll(ps => ps.map(p => `${p.textContent}:${p.dataset.id}`));
async function exportGame(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return readFileSync(await dl.path(), "utf8");
}
async function onPhone(browser, html, pins, run) {
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await phone.newPage();
    const { app, done } = await createApp({ page, context: phone });
    await app.open({ html, pins });
    await run(app, page);
    done();
  } finally { await phone.close(); }
}

test("rename, add, reorder and delete locations; the exported game follows exactly", async ({ page, browser }) => {
  const [first, second, third] = GAME.locations;

  // Rename the first location.
  await expect(page.locator("#locName")).toHaveValue(first.name);
  await page.locator("#locName").fill("Telok Ayer Park");
  await expect(page.locator("#capTarget option").first()).toHaveText("1. Telok Ayer Park");
  await expect(page.locator("#locUp")).toBeDisabled();

  // Add one: it appears at the end, selected, at the centre of the map, ready to name.
  await page.locator("#locAdd").click();
  await expect(page.locator(".pin")).toHaveCount(9);
  await expect(page.locator("#locName")).toBeFocused();
  await expect(page.locator("#poiInfo")).toContainText("new location");
  await expect(page.locator("#poiInfo")).toContainText("Drag its pin into place.");
  await page.locator("#locName").fill("Far East Square");
  const added = await page.locator("#capTarget").inputValue();
  expect(added).toMatch(/^l-[0-9a-z]{8}$/);
  await expect(page.locator("#locDown")).toBeDisabled();

  // Put it somewhere clear of the others, give it a challenge.
  const spot = offset(first, 400, 200);
  await page.locator("#poiCoords").fill(`${spot.lat.toFixed(6)}, ${spot.lng.toFixed(6)}`);
  await page.locator("#poiCoords").press("Enter");
  await page.locator("#arrivalEdit").fill("Welcome to the square.");
  await page.locator("#taskAdd").click();
  await page.locator("#tfPrompt").fill("What is the square named after?");
  await page.locator("#tfSave").click();

  // Move it up to second place; delete the old second (now third).
  await page.locator("#locUp").click();
  for (let i = 0; i < 7; i++) await page.locator("#locUp").click();
  await expect(page.locator("#capTarget option").first()).toHaveText("1. Far East Square");
  await page.locator("#locDown").click();
  await expect(page.locator("#capTarget option").nth(1)).toHaveText("2. Far East Square");
  await page.locator("#capTarget").selectOption(second.id);
  admin.expectDialog(`Delete ${second.name} and its ${second.tasks.length} challenges? Export first if you might want it back.`, { accept: true });
  await page.locator("#locDelete").click();
  await expect(page.locator(".pin")).toHaveCount(8);

  const expected = ["1. Telok Ayer Park", "2. Far East Square", ...GAME.locations.slice(2).map((l, i) => `${i + 3}. ${l.name}`)];
  expect(await optionTexts(page)).toEqual(expected);
  expect(await pinNumbers(page)).toEqual(expect.arrayContaining([`1:${first.id}`, `2:${added}`, `3:${third.id}`]));
  expect(await page.locator("#jump option").allTextContents()).toEqual(["Jump to a location…", ...expected]);

  // Survives a reload.
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await admin.openTools();
  expect(await optionTexts(page)).toEqual(expected);

  const html = await exportGame(page);
  expect(html).not.toContain("Far East Square");

  await onPhone(browser, html, 8, async (player, phonePage) => {
    expect(await pinNumbers(phonePage)).toEqual(expect.arrayContaining([`1:${first.id}`, `2:${added}`]));
    await expect(phonePage.locator(`.pin[data-id="${second.id}"]`)).toHaveCount(0);
    await expect(phonePage.locator("#total")).toHaveText("8");
    await player.begin(far(GAME.locations));
    for (let i = 0; i < 3; i++) await player.fix(offset(spot, 1, i * 120));
    await expect(phonePage.locator("#sheetname")).toHaveText("Far East Square");
    await expect(phonePage.locator("#sheettext")).toHaveText("Welcome to the square.");
    await phonePage.locator("#nextBtn").click();
    await expect(phonePage.locator("#prompt")).toHaveText("What is the square named after?");
  });
});

test("the title, start screen and clues screen wording come from the panel", async ({ page, browser }) => {
  await page.locator("#titleEdit").fill("The Jade Seal Affair");
  await expect(page).toHaveTitle("The Jade Seal Affair · Admin");
  await page.locator("#introEdit").fill("Find all the places.\nGood luck, detectives.");
  await page.locator("#revealIntroEdit").fill("Time's up. Who took the seal?");
  await page.locator("#previewReveal").click();
  await expect(page.locator("#revealTitle")).toHaveText("The Jade Seal Affair");
  await expect(page.locator("#revealLead")).toHaveText("Time's up. Who took the seal?");
  await page.locator("#revealClose").click();

  const html = await exportGame(page);
  expect(html).not.toContain("Jade Seal Affair");
  await onPhone(browser, html, 8, async (player, phonePage) => {
    await expect(phonePage).toHaveTitle("The Jade Seal Affair");
    await expect(phonePage.locator("#startTitle")).toHaveText("The Jade Seal Affair");
    expect(await phonePage.locator("#startIntro").evaluate(el => el.innerText)).toBe("Find all the places.\nGood luck, detectives.");
  });
});

test("an unnamed location or an empty title blocks export, and says where", async ({ page }) => {
  await page.locator("#capTarget").selectOption(GAME.locations[2].id);
  await page.locator("#locName").fill("  ");
  await expect(page.locator("#capTarget option").nth(2)).toHaveText("3. (unnamed)");
  await expect(page.locator("#exportGame")).toBeDisabled();
  await expect(page.locator("#exportInfo")).toContainText("Location 3: give it a name");
  await page.locator("#locName").fill("Nagore Dargah");
  await expect(page.locator("#exportGame")).toBeEnabled();

  await page.locator("#titleEdit").fill("");
  await expect(page.locator("#exportInfo")).toContainText("Game: the title is empty");
  await expect(page.locator("#exportGame")).toBeDisabled();
});

test("deleting the location a test team is standing in closes it cleanly", async ({ page }) => {
  const loc = GAME.locations[1];
  await page.locator("#jump").selectOption(loc.id);
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
  await page.locator("#capTarget").selectOption(loc.id);
  admin.expectDialog(`Delete ${loc.name} and its ${loc.tasks.length} challenges? Export first if you might want it back.`, { accept: true });
  await page.locator("#locDelete").click();
  await expect(page.locator("#sheet")).not.toHaveClass(/\bup\b/);
  await expect(page.locator(".pin.active")).toHaveCount(0);
  await expect(page.locator("#capTarget option")).toHaveCount(GAME.locations.length - 1);
});

test("the last remaining location can't be deleted", async ({ page }) => {
  for (let n = GAME.locations.length; n > 1; n--) {
    const name = await page.locator("#locName").inputValue();
    const loc = GAME.locations.find(l => l.name === name);
    admin.expectDialog(`Delete ${name} and its ${loc.tasks.length} challenges? Export first if you might want it back.`, { accept: true });
    await page.locator("#locDelete").click();
    await expect(page.locator(".pin")).toHaveCount(n - 1);
  }
  await expect(page.locator("#locDelete")).toBeDisabled();
  await expect(page.locator("#locCount")).toHaveText("1, pins numbered in this order");
});
