// Setting up the clues, suspects and reveal time in the admin panel on a computer,
// and checking a phone shows them from the exported file at the set time.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

const MIN = 60_000;
let admin;
test.beforeEach(async ({ app }) => {
  admin = app;
  await app.open();
  await app.openTools();
});

const clueRows = page => page.locator("#clueEdit > li");
const suspectRows = page => page.locator("#suspectEdit > li");
const values = locator => locator.evaluateAll(els => els.map(e => e.value));
async function setNumber(page, id, value) {
  await page.locator(`#${id}`).fill(String(value));
}
async function exportGame(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return readFileSync(await dl.path(), "utf8");
}

test("edit the timing, clues and suspects, and a phone shows exactly those at the set time", async ({ page, browser }) => {
  await expect(page.locator("#durationEdit")).toHaveValue("120");
  await expect(page.locator("#revealEdit")).toHaveValue("20");
  await expect(clueRows(page)).toHaveCount(GAME.clues.length);
  await expect(suspectRows(page)).toHaveCount(GAME.suspects.length);

  await setNumber(page, "durationEdit", 90);
  await setNumber(page, "revealEdit", 30);
  await expect(page.locator("#timingInfo")).toHaveText("Each team's clock starts when they tap Begin. Clues appear 60 minutes in, or as soon as a team has finished every location.");

  // Clues: reword the first, delete the second, add one, move the new one to the top.
  await clueRows(page).first().locator("textarea").fill("The first clue, reworded.");
  admin.expectDialog("Delete clue 2?", { accept: true });
  await clueRows(page).nth(1).locator(".tdel").click();
  await page.locator("#clueAdd").click();
  await expect(clueRows(page).last().locator("textarea")).toBeFocused();
  await clueRows(page).last().locator("textarea").fill("A brand new clue.");
  for (let i = GAME.clues.length - 1; i > 0; i--) await clueRows(page).nth(i).locator(".tup").click();
  const clues = ["A brand new clue.", "The first clue, reworded.", ...GAME.clues.slice(2).map(c => c.text)];
  expect(await values(clueRows(page).locator("textarea"))).toEqual(clues);

  // Suspects: add one with a name only, rename the first.
  await page.locator("#suspectAdd").click();
  await suspectRows(page).last().locator("input:not(.imglink)").fill("Mr. Nobody");
  await suspectRows(page).first().locator("input:not(.imglink)").fill("Tan Boon Seng (retired)");
  const suspects = ["Tan Boon Seng (retired)", ...GAME.suspects.slice(1).map(s => s.name), "Mr. Nobody"];

  // Survives a reload.
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await admin.openTools();
  await expect(page.locator("#durationEdit")).toHaveValue("90");
  await expect(page.locator("#revealEdit")).toHaveValue("30");
  expect(await values(clueRows(page).locator("textarea"))).toEqual(clues);
  expect(await values(suspectRows(page).locator("input:not(.imglink)"))).toEqual(suspects);

  const html = await exportGame(page);
  for (const secret of ["A brand new clue", "Mr. Nobody", "reworded"]) expect(html).not.toContain(secret);

  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const phonePage = await phone.newPage();
    await phonePage.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
    const { app: player, done } = await createApp({ page: phonePage, context: phone });
    await player.open({ html });
    await expect(phonePage.locator("#clock")).toHaveText("1:30:00");
    await player.begin(far(GAME.locations));
    await phonePage.clock.fastForward(59 * MIN);
    await expect(phonePage.locator("#reveal")).toBeHidden();
    await phonePage.clock.fastForward(1 * MIN + 1_000);
    await expect(phonePage.locator("#reveal")).toBeVisible();
    await expect(phonePage.locator("#clueList li")).toHaveText(clues);
    await expect(phonePage.locator("#suspectList li strong")).toHaveText(suspects);
    await expect(phonePage.locator("#revealClose")).toHaveCount(0);   // the preview button is admin-only
    done();
  } finally {
    await phone.close();
  }
});

test("export is blocked until timing, clues and suspects are complete", async ({ page }) => {
  await setNumber(page, "revealEdit", 200);
  await expect(page.locator("#exportGame")).toBeDisabled();
  await expect(page.locator("#exportInfo")).toContainText("Timing: the clues can't appear earlier than the start of the game");
  await expect(page.locator("#timingInfo")).toBeHidden();
  await setNumber(page, "revealEdit", 20);

  await page.locator("#clueAdd").click();                         // left empty
  await page.locator("#suspectAdd").click();                      // no name
  await expect(page.locator("#exportGame")).toBeDisabled();
  await expect(page.locator("#exportInfo")).toContainText(`Clues: clue ${GAME.clues.length + 1} is empty`);
  await expect(page.locator("#exportInfo")).toContainText(`Suspects: suspect ${GAME.suspects.length + 1} has no name`);

  await clueRows(page).last().locator("textarea").fill("Now it has words.");
  await suspectRows(page).last().locator("input:not(.imglink)").fill("Now has a name");
  await expect(page.locator("#exportGame")).toBeEnabled();

  await setNumber(page, "durationEdit", "");
  await expect(page.locator("#exportInfo")).toContainText("Timing: the game length must be a whole number of minutes");
  await expect(page.locator("#exportGame")).toBeDisabled();
});

test("Show the clues screen now previews it without touching progress", async ({ page }) => {
  await page.locator("#previewReveal").click();
  await expect(page.locator("#reveal")).toBeVisible();
  await page.waitForTimeout(2500);                                   // the screen's once-a-second update mustn't close it
  await expect(page.locator("#reveal")).toBeVisible();
  await expect(page.locator("#clueList li")).toHaveText(GAME.clues.map(c => c.text));
  await expect(page.locator("#drawer"), "the panel stays beside it on a computer").toBeInViewport();
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt-admin:chinatown-historical-hunt")).progress);
  expect(progress.revealed).toBe(false);

  await page.locator("#revealClose").click();
  await expect(page.locator("#reveal")).toBeHidden();
});

test("in the admin file, the clock slider triggers the clues for testing, and Reset progress clears them", async ({ page }) => {
  await page.locator("#clockSet").evaluate(el => { el.value = "10"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(page.locator("#reveal")).toBeVisible();
  await expect(page.locator("#revealClose")).toBeHidden();

  admin.expectDialog("Clear all game progress? Location edits and the walk recording are kept.", { accept: true });
  await page.locator("#reset").click();
  await expect(page.locator("#reveal")).toBeHidden();
  await expect(page.locator("#clockSetO")).toHaveText("120 min");
});

test("once the clues are showing, simulated positions inside a location open nothing", async ({ page }) => {
  await page.locator("#clockSet").evaluate(el => { el.value = "10"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(page.locator("#reveal")).toBeVisible();
  await page.locator("#jump").selectOption("thian-hock-keng");      // keeps sending positions on the pin
  await expect.poll(async () => +(await page.locator("#fixcount").textContent())).toBeGreaterThan(3);
  await expect(page.locator(".pin.active, .pin.reached")).toHaveCount(0);
});

test.describe("while editing, the clues never come up on their own", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
  });

  test("not after hours at the admin panel, and locations still open for testing", async ({ app, page }) => {
    await app.open();
    await page.clock.fastForward(3 * 60 * MIN);
    await expect(page.locator("#clock")).toHaveText("0:00:00");
    await expect(page.locator("#reveal")).toBeHidden();
    await app.openTools();
    await page.locator("#jump").selectOption("thian-hock-keng");
    await expect(page.locator("#sheetname")).toHaveText("Thian Hock Keng Temple");
    await expect(page.locator("#closingNote")).toHaveCount(0);
    await page.locator("#solveAll").click();
    await expect(page.locator("#reveal")).toBeHidden();
  });

  test("not after finishing every location", async ({ app, page }) => {
    await app.open();
    await app.openTools();
    const ids = await page.locator("#jump option").evaluateAll(os => os.map(o => o.value).filter(Boolean));
    for (const id of ids) {
      await page.locator("#jump").selectOption(id);
      await expect(page.locator(".pin.active")).toHaveCount(1);
      await page.locator("#solveAll").click();
      await expect(page.locator(".pin.active")).toHaveCount(0);
    }
    await expect(page.locator(".pin.reached")).toHaveCount(ids.length);
    await expect(page.locator("#reveal")).toBeHidden();
  });

  test("a clues screen left over from an earlier session is cleared", async ({ app, page }) => {
    await app.open();
    await page.evaluate(() => {
      const k = "chinatown-hunt-admin:chinatown-historical-hunt", d = JSON.parse(localStorage.getItem(k));
      d.progress.revealed = true;
      localStorage.setItem(k, JSON.stringify(d));
    });
    await page.reload();
    await expect(page.locator(".pin")).toHaveCount(8);
    await expect(page.locator("#reveal")).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt-admin:chinatown-historical-hunt")).progress.revealed)).toBe(false);
  });

  test("but the preview keeps the real timing", async ({ app, page }) => {
    await app.open();
    await app.openTools();
    const [pv] = await Promise.all([page.waitForEvent("popup"), page.locator("#previewGame").click()]);
    await pv.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
    await pv.reload();
    await pv.locator("#startBtn").click();
    await pv.clock.fastForward((GAME.durationMinutes - GAME.revealMinutes) * MIN + 1000);
    await expect(pv.locator("#reveal")).toBeVisible();
  });
});
