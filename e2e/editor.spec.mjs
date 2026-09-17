// Building challenges in the admin panel on a computer, and playing them from the exported file.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, offset, pickArrival, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

const THK = GAME.locations.find(l => l.id === "thian-hock-keng");
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);

let admin;
test.beforeEach(async ({ app, page }) => {
  admin = app;
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
});

const items = page => page.locator("#taskList > li");
const prompts = page => page.locator("#taskList .tprompt");

async function deleteAll(page) {
  const n = await items(page).count();
  for (let i = n; i >= 1; i--) {
    admin.expectDialog(`Delete challenge ${i} at ${THK.name}? Teams who already answered it keep their points.`, { accept: true });
    await items(page).nth(i - 1).locator(".tdel").click();
  }
  await expect(items(page)).toHaveCount(0);
}
async function addChallenge(page, t) {
  await page.locator("#taskAdd").click();
  await page.locator("#tfPrompt").fill(t.prompt);
  if (t.image) await page.locator("#tfImage").fill(t.image);
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskForm")).toBeHidden();
}
// Run an action that reloads the page (Start over, Import) and wait until the new page is ready.
async function reloadsPage(page, action) {
  await Promise.all([page.waitForEvent("framenavigated"), action()]);
  await page.waitForLoadState("load");
  await expect(page.locator(".pin")).toHaveCount(8);
}
async function exportGame(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return readFileSync(await dl.path(), "utf8");
}

const NEW = [
  { prompt: "Find the temple's name in English on the signboard." },
  { prompt: "Count the doors of the main hall.", image: "https://img.test/hunt/doors.png" },
  { prompt: "What are the pillars made of?\nLook closely at the base." },
];

test("build challenges, reorder them, and a phone shows them in that order", async ({ page, browser }) => {
  await deleteAll(page);
  await expect(page.locator("#taskCount")).toHaveText("No challenges yet");
  for (const t of NEW) await addChallenge(page, t);
  await expect(prompts(page)).toHaveText(NEW.map(t => t.prompt.replace("\n", " ")));
  await expect(items(page).nth(1).locator(".tpts")).toHaveText("image");
  await expect(page.locator("#tfType, #tfAccept, #tfHint, #tfAnswer, #tfOptions")).toHaveCount(0);

  // [a, b, c] → up on 3rd → [a, c, b] → up on 2nd → [c, a, b] → down on 2nd → [c, b, a].
  await items(page).nth(2).locator(".tup").click();
  await items(page).nth(1).locator(".tup").click();
  await items(page).nth(1).locator(".tdown").click();
  const shown = [NEW[2], NEW[1], NEW[0]];
  await expect(prompts(page)).toHaveText(shown.map(t => t.prompt.replace("\n", " ")));
  await expect(items(page).first().locator(".tup")).toBeDisabled();
  await expect(items(page).last().locator(".tdown")).toBeDisabled();

  await page.locator("#arrivalEdit").fill("Welcome to the temple. Look closely.");
  await expect(page.locator("#exportInfo")).toContainText("17 challenges");
  const html = await exportGame(page);
  expect(html).not.toContain("pillars made of");
  expect(html).not.toContain("Welcome to the temple");

  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const phonePage = await phone.newPage();
    const { app: player, done } = await createApp({ page: phonePage, context: phone });
    await player.open({ html });
    await player.begin(far(GAME.locations));
    for (const p of route.approach) await player.fix(p);
    for (let i = 0; i < 3; i++) await player.fix(offset(THK, 1, i * 120));

    await expect(phonePage.locator("#sheettext")).toHaveText("Welcome to the temple. Look closely.");
    await phonePage.locator("#nextBtn").click();
    for (const [i, t] of shown.entries()) {
      await expect(phonePage.locator("#sheetplace")).toHaveText(`challenge ${i + 1} of 3`);
      expect(await phonePage.locator("#prompt").evaluate(el => el.innerText)).toBe(t.prompt);
      await expect(phonePage.locator("#stage figure")).toHaveCount(t.image ? 1 : 0);
      if (i < 2) await phonePage.locator("#nextBtn").click();
    }
    await phonePage.locator("#finishBtn").click();
    await expect(phonePage.locator("#reached")).toHaveText("1");
    done();
  } finally {
    await phone.close();
  }
});

test("editing a challenge keeps its place and id; Cancel changes nothing", async ({ page }) => {
  const draftIds = () => page.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt-m1:draft")).game.locations.find(l => l.id === "thian-hock-keng").tasks.map(t => t.id));

  await items(page).nth(1).locator(".tedit").click();
  await expect(page.locator("#tfTitle")).toHaveText("Edit challenge 2");
  await expect(page.locator("#tfPrompt")).toHaveValue(THK.tasks[1].prompt);
  await page.locator("#tfPrompt").fill("Count the lions. Carefully.");
  await page.locator("#tfCancel").click();
  await expect(prompts(page).nth(1)).toHaveText(THK.tasks[1].prompt);

  await items(page).nth(1).locator(".tedit").click();
  await page.locator("#tfPrompt").fill("Count the lions. Carefully.");
  await page.locator("#tfSave").click();
  await expect(prompts(page).nth(1)).toHaveText("Count the lions. Carefully.");
  expect(await draftIds()).toEqual(THK.tasks.map(t => t.id));
});

test("an empty challenge can't be saved; a picture on its own is fine", async ({ page }) => {
  await page.locator("#taskAdd").click();
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toHaveText("Can't save yet: add some text or a picture");
  await expect(items(page)).toHaveCount(THK.tasks.length);

  await page.locator("#tfImage").fill("https://img.test/hunt/only.png");
  await page.locator("#tfSave").click();
  await expect(items(page)).toHaveCount(THK.tasks.length + 1);
  await expect(prompts(page).last()).toHaveText("(picture only)");
});

test("challenges from older versions lose their answer fields on export", async ({ page }) => {
  await page.locator("#arrivalEdit").fill(THK.arrivalText + " ");
  await page.evaluate(() => {
    const k = "chinatown-hunt-m1:draft", d = JSON.parse(localStorage.getItem(k));
    d.game.locations.find(l => l.id === "thian-hock-keng").tasks[0] =
      { id: "t-thk-01", type: "multiple_choice", prompt: "Old style", options: ["A", "B"], answer: 1, hint: "old hint", points: 100 };
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await admin.openTools();
  await expect(page.locator("#exportGame")).toBeEnabled();
  await page.locator("#arrivalEdit").fill(THK.arrivalText);          // saves the draft through the export path
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt-m1:draft")).game.locations.find(l => l.id === "thian-hock-keng").tasks[0]);
  expect(saved).toEqual({ id: "t-thk-01", prompt: "Old style" });
});

test("export is blocked while any challenge has a problem, and the panel lists it", async ({ page }) => {
  await page.locator("#capTarget").selectOption("amoy-street");
  await items(page).first().locator(".tedit").click();
  await page.locator("#tfImage").fill("amoy.png");
  await expect(page.locator("#tfImagePrev")).toHaveText("the image link isn't a web address");
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toHaveText("Can't save yet: the image link isn't a web address");
  await page.locator("#tfCancel").click();

  // A broken challenge that got into the draft (e.g. from an older version) blocks export.
  await page.locator("#arrivalEdit").fill("Amoy Street welcome.");     // make sure a draft exists
  await page.evaluate(() => {
    const k = "chinatown-hunt-m1:draft", d = JSON.parse(localStorage.getItem(k));
    d.game.locations.find(l => l.id === "amoy-street").tasks[0] = { id: "t-amo-01", prompt: " " };
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await admin.openTools();
  await expect(page.locator("#exportGame")).toBeDisabled();
  await expect(page.locator("#exportInfo")).toHaveText("Fix this before exporting:\n• Amoy Street, challenge 1: add some text or a picture");

  await page.locator("#capTarget").selectOption("amoy-street");
  await expect(items(page).first()).toHaveClass(/\bbad\b/);
  await items(page).first().locator(".tedit").click();
  await page.locator("#tfPrompt").fill("What was Amoy's later name?");
  await page.locator("#tfSave").click();
  await expect(page.locator("#exportGame")).toBeEnabled();
});

test("your work survives a reload, Start over returns to the default, and Import brings an export back", async ({ page }) => {
  await page.locator("#arrivalEdit").fill("A rewritten welcome.");
  await addChallenge(page, NEW[0]);
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await admin.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await expect(page.locator("#arrivalEdit")).toHaveValue("A rewritten welcome.");
  await expect(prompts(page).last()).toHaveText(NEW[0].prompt);

  const html = await exportGame(page);

  admin.expectDialog("Throw away all your changes (locations, text and challenges) and start again from the default game? Export first if you might want them.", { accept: true });
  await reloadsPage(page, () => page.locator("#resetDraft").click());
  await admin.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await expect(page.locator("#arrivalEdit")).toHaveValue(THK.arrivalText);
  await expect(items(page)).toHaveCount(THK.tasks.length);

  admin.expectDialog("Replace the game you're building here with the one in chinatown-hunt.html?", { accept: true });
  await reloadsPage(page, () => page.locator("#importGame").setInputFiles({ name: "chinatown-hunt.html", mimeType: "text/html", buffer: Buffer.from(html) }));
  await admin.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await expect(page.locator("#arrivalEdit")).toHaveValue("A rewritten welcome.");
  await expect(prompts(page).last()).toHaveText(NEW[0].prompt);
});

test("importing something that isn't an exported game is refused", async ({ page }) => {
  admin.expectDialog("Couldn't import notes.html: it isn't an exported game file.");
  await page.locator("#importGame").setInputFiles({ name: "notes.html", mimeType: "text/html", buffer: Buffer.from("<p>hello</p>") });
  await expect(items(page)).toHaveCount(THK.tasks.length);
});
