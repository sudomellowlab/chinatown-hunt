// Answers on a challenge: set in the admin panel, given by a team on a phone playing the exported file.
// Text answers may use * for "anything"; numbers ignore commas; multiple choice is tapped.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, offset, pickArrival, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

const THK = GAME.locations.find(l => l.id === "thian-hock-keng");   // 3 challenges
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);

// Set the answer on challenge `n` of the selected location, through the admin panel.
async function setAnswer(page, n, kind, fill) {
  await page.locator("#taskList li").nth(n).locator(".tedit").click();
  await page.locator("#tfAnswer select").selectOption(kind);
  await fill();
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskForm")).toBeHidden();
}

async function exportGame(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return readFileSync(await dl.path(), "utf8");
}

// Play the exported file on a phone, standing at Thian Hock Keng.
async function atTheTemple(browser, html, fn) {
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await phone.newPage();
    const { app, done } = await createApp({ page, context: phone });
    await app.open({ html });
    await app.begin(far(GAME.locations));
    for (const p of route.approach) await app.fix(p);
    for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
    await expect(page.locator("#sheetname")).toHaveText(THK.name);
    await fn(page, app);
    done();
  } finally {
    await phone.close();
  }
}

test("a team must answer text, number and multiple choice challenges before moving on", async ({ app, page, browser }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);

  await setAnswer(page, 0, "text", () => page.locator("#tfAnswer textarea").fill("*lotus*\ndurian"));
  await setAnswer(page, 1, "number", () => page.locator("#tfAnswer textarea").fill("1844"));
  await setAnswer(page, 2, "choice", async () => {
    const options = page.locator("#tfAnswer .optlist li");
    await options.nth(0).locator("input[type=text]").fill("Guangzhou");
    await options.nth(1).locator("input[type=text]").fill("Fujian");
    await options.nth(1).locator("input[type=checkbox]").check();
  });
  await expect(page.locator("#taskList li").nth(0).locator(".tpts")).toContainText("text answer");
  await expect(page.locator("#taskList li").nth(1).locator(".tpts")).toContainText("number answer");
  await expect(page.locator("#taskList li").nth(2).locator(".tpts")).toContainText("multiple choice");

  const html = await exportGame(page);
  for (const secret of ["*lotus*", "durian", "Guangzhou", "Fujian"]) expect(html).not.toContain(secret);

  await atTheTemple(browser, html, async (phone) => {
    await expect(phone.locator("#stage .small")).toHaveText(
      "3 challenges here. Answer them here to move on, then finish this location before moving on.");
    await phone.locator("#nextBtn").click();

    // 1. Text, with * standing for anything.
    await expect(phone.locator("#nextBtn")).toBeDisabled();
    await phone.locator("#answerInput").fill("mango");
    await phone.locator("#answerCheck").click();
    await expect(phone.locator("#answerMsg")).toHaveText("Not quite. Try again.");
    await expect(phone.locator("#nextBtn")).toBeDisabled();
    await phone.locator("#answerInput").fill(" Blue Lotus ");     // matches *lotus*, whatever the capitals
    await phone.locator("#answerInput").press("Enter");
    await expect(phone.locator("#answerBox")).toHaveClass(/solved/);
    await expect(phone.locator("#answerBox")).toContainText("Blue Lotus");
    await expect(phone.locator("#nextBtn")).toBeEnabled();
    await phone.locator("#nextBtn").click();

    // 2. A number, however it's typed.
    await expect(phone.locator("#answerInput")).toHaveAttribute("inputmode", "decimal");
    await phone.locator("#answerInput").fill("1843");
    await phone.locator("#answerCheck").click();
    await expect(phone.locator("#answerMsg")).toHaveText("Not quite. Try again.");
    await phone.locator("#answerInput").fill("1,844");
    await phone.locator("#answerCheck").click();
    await expect(phone.locator("#answerBox")).toHaveClass(/solved/);
    await phone.locator("#nextBtn").click();

    // 3. Multiple choice: the last challenge, so Finish waits for it.
    const options = phone.locator("#answerBox .choicebtn");
    await expect(options).toHaveText(["Guangzhou", "Fujian"]);
    await expect(phone.locator("#finishBtn")).toBeDisabled();
    await options.nth(0).click();
    await expect(phone.locator("#answerMsg")).toHaveText("Not quite. Try again.");
    await expect(phone.locator("#finishBtn")).toBeDisabled();
    await options.nth(1).click();
    await expect(phone.locator("#answerBox")).toContainText("Fujian");
    await expect(phone.locator("#finishBtn")).toBeEnabled();

    // Answers already given survive a reload, and Back doesn't lose them.
    await phone.reload();
    await expect(phone.locator("#startBtn")).toHaveText("Continue");
    await phone.locator("#startBtn").click();
    await expect(phone.locator("#start")).toBeHidden();
    await expect(phone.locator("#answerBox")).toHaveClass(/solved/);
    await phone.locator("#backBtn").click();
    await expect(phone.locator("#sheetplace")).toHaveText("challenge 2 of 3");
    await expect(phone.locator("#answerBox")).toContainText("1,844");
    await phone.locator("#nextBtn").click();
    await phone.locator("#finishBtn").click();
    await expect(phone.locator("#reached")).toHaveText("1");
  });
});

test("challenges with no answer set are unchanged, and one can be taken off again", async ({ app, page, browser }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await setAnswer(page, 0, "text", () => page.locator("#tfAnswer textarea").fill("apple"));
  await setAnswer(page, 0, "", () => {});                    // back to "No answer here"
  await expect(page.locator("#taskList li").nth(0).locator(".tpts")).not.toContainText("answer");

  const html = await exportGame(page);
  await atTheTemple(browser, html, async (phone) => {
    await phone.locator("#nextBtn").click();
    await expect(phone.locator("#answerBox")).toHaveCount(0);
    await expect(phone.locator("#nextBtn")).toBeEnabled();
  });
});

test("an incomplete answer can't be saved, and blocks export if it slips through", async ({ app, page }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);

  await page.locator("#taskList li").first().locator(".tedit").click();
  await page.locator("#tfAnswer select").selectOption("choice");
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toContainText("one of the options is empty");
  await expect(page.locator("#tfErrors")).toContainText("mark the correct option");
  await expect(page.locator("#taskForm")).toBeVisible();

  await page.locator("#tfAnswer select").selectOption("number");
  await page.locator("#tfAnswer textarea").fill("about 1844");
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toContainText('the answer "about 1844" isn\'t a number');

  await page.locator("#tfAnswer textarea").fill("1844");
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskForm")).toBeHidden();
  await expect(page.locator("#exportGame")).toBeEnabled();
});
