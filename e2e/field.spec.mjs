// Field tools: a password set in the admin panel locks a developer panel into the exported game,
// opened on a phone by tapping the timer five times and typing that password.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, far } from "./fixtures.mjs";

const PASSWORD = "lantern-42";

async function exportWith(page, app, password) {
  await app.openTools();
  await page.locator("#fieldPass").fill(password);
  await expect(page.locator("#exportGame")).toBeEnabled();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return readFileSync(await dl.path(), "utf8");
}

// Play an exported file on a separate phone.
async function onPhone(browser, html, fn) {
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await phone.newPage();
    const { app, done } = await createApp({ page, context: phone });
    await app.open({ html });
    await fn(page, app);
    done();
  } finally {
    await phone.close();
  }
}
const tap = async (el, n = 5) => { for (let i = 0; i < n; i++) await el.click(); };

test("with a password, the exported game hides locked field tools that open after five taps and the password", async ({ app, page, browser }) => {
  await app.open();
  const locs = await app.locations();
  const html = await exportWith(page, app, PASSWORD);
  await expect(page.locator("#fieldInfo")).toContainText("tap the timer 5 times");

  // Neither the password nor the tools can be read in the file.
  expect(html).toMatch(/const FIELD_PACK = "ctv1\.\d+\./);
  for (const secret of [PASSWORD, "Pretend to be", "ftPanel", "Restart this phone", "fieldTools(app){"]) expect(html).not.toContain(secret);

  await onPhone(browser, html, async (phone, player) => {
    const box = phone.locator("#unlock"), panel = phone.locator("#ftPanel");
    // Before Begin, the title works as the tap target.
    await tap(phone.locator("#startTitle"), 4);
    await expect(box).toBeHidden();
    await phone.locator("#startTitle").click();
    await expect(box).toBeVisible();
    await expect(phone.locator("#unlockPass")).toBeFocused();
    await phone.locator("#unlockCancel").click();
    await expect(box).toBeHidden();

    await player.begin(far(locs));
    await tap(phone.locator("#clock"));
    await expect(box).toBeVisible();
    await expect(phone.locator("#unlockPass")).toHaveAttribute("type", "password");
    await phone.locator("#unlockPass").fill("lantern-41");
    await phone.locator("#unlockPass").press("Enter");
    await expect(phone.locator("#unlockMsg")).toHaveText("Wrong password.");
    await expect(panel).toHaveCount(0);

    await phone.locator("#unlockPass").fill(PASSWORD);
    await phone.locator("#unlockOk").click();
    await expect(box).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(phone.locator("#ftState")).toContainText("done     0 of 8");
    await expect(phone.locator("#ftState")).toContainText("left");
    // The fix log starts when the tools are unlocked.
    await expect(phone.locator("#ftLog")).toHaveText("No positions yet.");
    await player.fix(far(locs));
    await expect(phone.locator("#ftLog")).toContainText("real ±8m ✓");

    // Pretend to be at a location: it opens through the normal GPS path.
    const loc = locs[3];
    await phone.locator("#ftGo").selectOption(loc.id);
    await expect(panel).toBeHidden();
    await expect(phone.locator("#sheet")).toHaveClass(/\bup\b/);
    await expect(phone.locator("#sheetname")).toHaveText(loc.name);
    await expect(phone.locator("#srctxt")).toHaveText("pretend position");

    // Once unlocked, the taps open the tools straight away, here from the location's title.
    await tap(phone.locator("#sheetname"));
    await expect(box).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(phone.locator("#ftState")).toContainText(`open: ${loc.name}`);
    await expect(phone.locator("#ftLog")).toContainText("OPENED");
    await phone.locator("#ftFinish").click();
    await expect(panel).toBeHidden();
    await expect(phone.locator("#sheet")).not.toHaveClass(/\bup\b/);
    await expect(phone.locator("#reached")).toHaveText("1");

    // Back to real GPS.
    await tap(phone.locator("#clock"));
    await phone.locator("#ftReal").click();
    await expect(phone.locator("#ftReal")).toHaveClass(/\bon\b/);
    await expect(phone.locator("#srctxt")).toHaveText("live GPS");

    // The clock: set the minutes left, then skip to the clues.
    await phone.locator("#ftMinutes").fill("30");
    await phone.locator("#ftSetClock").click();
    await expect(phone.locator("#clock")).toHaveText(/^0:(30:00|29:5\d)$/);
    await phone.locator("#ftClues").click();
    await expect(panel).toBeHidden();
    await expect(phone.locator("#reveal")).toBeVisible();

    // The clues screen's title opens the tools too; Restart this phone goes back to the start.
    await tap(phone.locator("#revealTitle"));
    await expect(panel).toBeVisible();
    player.expectDialog("Clear this phone's progress and clock, and go back to the start screen?", { accept: true });
    await phone.locator("#ftRestart").click();
    await expect(phone.locator("#startBtn")).toHaveText("Begin");
    await expect(phone.locator("#reveal")).toBeHidden();
    await expect(phone.locator("#reached")).toHaveText("0");
    // A reload locks the tools again.
    await tap(phone.locator("#startTitle"));
    await expect(box).toBeVisible();
  });
});

test("tapping the map while Tap the map to move is on moves the pretend position", async ({ app, page, browser }) => {
  await app.open();
  const locs = await app.locations();
  const html = await exportWith(page, app, PASSWORD);
  await onPhone(browser, html, async (phone, player) => {
    await player.begin(far(locs));
    await tap(phone.locator("#clock"));
    await phone.locator("#unlockPass").fill(PASSWORD);
    await phone.locator("#unlockPass").press("Enter");
    await phone.locator("#ftTap").click();
    await expect(phone.locator("#ftPanel")).toBeHidden();
    await expect(phone.locator("body")).toHaveClass(/\bfttap\b/);
    await phone.locator("#map").click({ position: { x: 60, y: 300 } });
    await expect(phone.locator("#srctxt")).toHaveText("pretend position");
    const at = await phone.evaluate(() => document.querySelector("#acc").textContent);
    expect(at).toBe("5");
  });
});

test("without a password the exported game has no field tools, and a short password blocks export", async ({ app, page, browser }) => {
  await app.open();
  await app.openTools();
  await expect(page.locator("#fieldInfo")).toContainText("Optional");
  await expect(page.locator("#exportInfo")).toContainText("no field tools");

  await page.locator("#fieldPass").fill("abc");
  await expect(page.locator("#exportGame")).toBeDisabled();
  await expect(page.locator("#exportInfo")).toContainText("Field tools password: use at least 6 characters");
  await page.locator("#fieldPassShow").click();
  await expect(page.locator("#fieldPass")).toHaveAttribute("type", "text");

  // The password is kept in this browser across a reload, but not in the game draft.
  await page.locator("#fieldPass").fill(PASSWORD);
  await page.locator("#titleEdit").fill("Field day hunt");
  await page.reload();
  await app.openTools();
  await expect(page.locator("#fieldPass")).toHaveValue(PASSWORD);
  const draft = await page.evaluate(() => localStorage.getItem("chinatown-hunt-m1:draft"));
  expect(draft).toContain("Field day hunt");
  expect(draft).not.toContain(PASSWORD);

  const html = await exportWith(page, app, "");
  expect(html).toContain("const FIELD_PACK = null");
  await onPhone(browser, html, async phone => {
    await tap(phone.locator("#startTitle"), 8);
    await expect(phone.locator("#unlock")).toBeHidden();
  });
});
