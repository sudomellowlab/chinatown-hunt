// The starting challenge: set up in the admin panel on a computer. On a phone playing the exported file
// it opens at Begin and asks for the password the LoQuiz host gives out; no location opens until it's done.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, far, pickArrival } from "./fixtures.mjs";

const PASSWORD = "Red Lantern";
const WELCOME = "Welcome to Telok Ayer. Your first tasks are waiting.";
const LOCK = "Meet your host at the lantern stall. They'll tell you the password.";
const TASKS = ["Find the red lantern and count its tassels.", "Name the street the lantern hangs on."];
const FILE = "chinatown-hunt.html";

const startRows = page => page.locator("#startTaskEdit > li");
async function exportGame(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return readFileSync(await dl.path(), "utf8");
}
async function setUpStart(app, page) {
  await app.open();
  await app.openTools();
  await page.locator("#startAdd").click();
  await expect(page.locator("#startPassEdit")).toBeFocused();
  await expect(page.locator("#startInfo")).toContainText("set a password");
  await expect(page.locator("#startLockEdit")).toHaveAttribute("placeholder", /Your LoQuiz host will give you a password/);
  await page.locator("#startLockEdit").fill(LOCK);
  await page.locator("#startPassEdit").fill(PASSWORD);
  await page.locator("#startTextEdit").fill(WELCOME);
  await startRows(page).first().locator("textarea").fill(TASKS[0]);
  await page.locator("#startTaskAdd").click();
  await expect(startRows(page).last().locator("textarea")).toBeFocused();
  await startRows(page).last().locator("textarea").fill(TASKS[1]);
  await expect(page.locator("#startInfo")).toHaveText('Teams type "red lantern" (in any capitals) to open it.');
  await expect(page.locator("#exportInfo")).toContainText("a starting challenge, locked with its password");
}

test("a phone must type the LoQuiz password before its first challenge, and no location opens until it's done", async ({ app, page, browser }) => {
  await setUpStart(app, page);
  const locs = await app.locations();
  await app.openTools();
  const html = await exportGame(page);
  for (const secret of [PASSWORD, PASSWORD.toLowerCase(), LOCK, WELCOME, ...TASKS]) expect(html).not.toContain(secret);

  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const phonePage = await phone.newPage();
    const { app: player, done } = await createApp({ page: phonePage, context: phone });
    await player.open({ html });
    await player.begin(far(locs));

    // Begin opens the starting challenge at once, locked, wherever the team is.
    await expect(player.sheet()).toHaveClass(/\bup\b/);
    await expect(phonePage.locator("#sheetname")).toHaveText("Before you set off");
    await expect(phonePage.locator("#startPass")).toBeVisible();
    await expect(phonePage.locator("#sheettext")).toHaveText(LOCK);
    for (const text of [WELCOME, ...TASKS]) await expect(phonePage.getByText(text)).toHaveCount(0);

    // Walking into a location opens nothing while it's locked.
    const { loc, approach } = pickArrival(locs);
    for (const p of approach) await player.fix(p);
    for (let i = 0; i < 3; i++) await player.fix(loc);
    await expect(player.opened()).toHaveCount(0);
    await expect(phonePage.locator("#override")).not.toHaveClass(/\bshow\b/);

    // A wrong password says so and keeps it locked; the right one, in other capitals, opens it.
    await phonePage.locator("#startPass").fill("blue lantern");
    await phonePage.locator("#startPass").press("Enter");
    await expect(phonePage.locator("#startPassMsg")).toHaveText("That isn't the password. Check it with your LoQuiz host and try again.");
    await phonePage.locator("#startPass").fill("  RED   lantern ");
    await phonePage.locator("#startUnlock").click();
    // Straight to the first challenge: no screen in between, with its text above it and no Back.
    await expect(phonePage.locator("#prompt")).toHaveText(TASKS[0]);
    await expect(phonePage.locator("#sheettext")).toHaveText(WELCOME);
    await expect(phonePage.locator("#sheetplace")).toHaveText("starting challenge 1 of 2");
    await expect(phonePage.locator("#backBtn")).toHaveCount(0);

    // Part-way through, a reload comes back to the same challenge without asking again.
    await phonePage.reload();
    await expect(phonePage.locator("#startBtn")).toHaveText("Continue");
    await player.begin(loc);
    await expect(phonePage.locator("#prompt")).toHaveText(TASKS[0]);
    await expect(phonePage.locator("#startPass")).toHaveCount(0);

    // Back and Next from there on; Finish on the last one frees the map.
    await phonePage.locator("#nextBtn").click();
    await expect(phonePage.locator("#sheetplace")).toHaveText("starting challenge 2 of 2");
    await expect(phonePage.locator("#prompt")).toHaveText(TASKS[1]);
    await expect(phonePage.locator("#sheettext")).toHaveCount(0, "the text only sits above the first challenge");
    await phonePage.locator("#backBtn").click();
    await expect(phonePage.locator("#prompt")).toHaveText(TASKS[0]);
    await phonePage.locator("#nextBtn").click();
    await phonePage.locator("#finishBtn").click();
    await expect(player.sheet()).not.toHaveClass(/\bup\b/);
    await expect(player.reached()).toHaveText("0");

    // Now the location the team is standing in opens.
    for (let i = 0; i < 3; i++) await player.fix(loc);
    await expect(player.opened()).toHaveCount(1);
    await expect(phonePage.locator("#sheetname")).toHaveText(loc.name);
    done();
  } finally {
    await phone.close();
  }
});

test("import brings the starting challenge back only with its password; Remove takes it out", async ({ app, page }) => {
  await setUpStart(app, page);
  const html = await exportGame(page);
  const upload = () => page.locator("#importGame").setInputFiles({ name: FILE, mimeType: "text/html", buffer: Buffer.from(html) });
  const replace = `Replace the game you're building here with the one in ${FILE}?`;
  const ask = `${FILE} has a starting challenge, locked with its password. Type that password to import it:`;

  // Start over, so the draft no longer has it.
  app.expectDialog("Throw away all your changes (locations, text and challenges) and start again from the default game? Export first if you might want them.", { accept: true });
  await page.locator("#resetDraft").click();
  await expect(page.locator(".pin")).toHaveCount(8);
  await app.openTools();
  await expect(page.locator("#startAdd")).toBeVisible();

  // A wrong password imports nothing.
  app.expectDialog(replace, { accept: true });
  app.expectDialog(ask, { accept: true, value: "wrong" });
  app.expectDialog("That isn't the starting challenge's password, so nothing was imported.");
  await upload();
  await expect(page.locator("#startAdd")).toBeVisible();

  // The right one restores it all.
  app.expectDialog(replace, { accept: true });
  app.expectDialog(ask, { accept: true, value: "red lantern" });
  await upload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await app.openTools();
  await expect(page.locator("#startFields")).toBeVisible();
  await expect(page.locator("#startName")).toHaveValue("Before you set off");
  await expect(page.locator("#startLockEdit")).toHaveValue(LOCK);
  await expect(page.locator("#startPassEdit")).toHaveValue("red lantern");
  await expect(page.locator("#startTextEdit")).toHaveValue(WELCOME);
  expect(await startRows(page).locator("textarea").evaluateAll(els => els.map(e => e.value))).toEqual(TASKS);

  // Remove: teams begin straight onto the map again.
  app.expectDialog("Remove the starting challenge and its 2 challenges? Teams will begin straight onto the map. Export first if you might want it back.", { accept: true });
  await page.locator("#startRemove").click();
  await expect(page.locator("#startAdd")).toBeVisible();
  await expect(page.locator("#exportInfo")).not.toContainText("starting challenge");
});

test("Try it here opens it in the admin file, and it survives a reload", async ({ app, page }) => {
  await setUpStart(app, page);
  await page.locator("#startTry").click();
  await expect(page.locator("#startPass")).toBeVisible();
  await expect(page.locator("#sheettext")).toHaveText(LOCK);
  // Emptied, the screen falls back to the standard wording.
  await page.locator("#startLockEdit").fill("");
  await expect(page.locator("#sheettext")).toHaveText("Your LoQuiz host will give you a password. Type it here to see your first challenge.");
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await expect(page.locator("#startPass")).toBeVisible();
  await page.locator("#startPass").fill(PASSWORD);
  await page.locator("#startPass").press("Enter");
  await expect(page.locator("#sheettext")).toHaveText(WELCOME);
});
