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
  await page.locator("#tfType").selectOption(t.type);
  await page.locator("#tfPrompt").fill(t.prompt);
  if (t.type === "multiple_choice") {
    for (let i = 0; i < t.options.length; i++) {
      if (i >= await page.locator(".optrow").count()) await page.locator("#tfAddOption").click();
      await page.locator(".optrow .tfOpt").nth(i).fill(t.options[i]);
    }
    await page.locator(".optrow [type=radio]").nth(t.answer).check();
  } else if (t.type === "text") {
    await page.locator("#tfAccept").fill(t.accept.join("\n"));
  } else {
    await page.locator("#tfAnswer").fill(String(t.answer));
    if (t.tolerance) await page.locator("#tfTolerance").fill(String(t.tolerance));
  }
  if (t.hint) await page.locator("#tfHint").fill(t.hint);
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
  { type: "text", prompt: "What is the temple's name in English?", accept: ["Temple of Heavenly Happiness", "heavenly happiness"] },
  { type: "number", prompt: "How many doors does the main hall have?", answer: 3, tolerance: 0, hint: "Count them from the courtyard." },
  { type: "multiple_choice", prompt: "Which material are the pillars?", options: ["Granite", "Teak", "Brick"], answer: 0 },
];

test("build challenges of every type, reorder them, and a phone plays them in that order", async ({ page, browser }) => {
  await deleteAll(page);
  for (const t of NEW) await addChallenge(page, t);
  await expect(prompts(page)).toHaveText(NEW.map(t => t.prompt));

  // [text, number, choice] → up on 3rd → [text, choice, number] → up on 2nd → [choice, text, number] → down on 2nd.
  await items(page).nth(2).locator(".tup").click();
  await items(page).nth(1).locator(".tup").click();
  await items(page).nth(1).locator(".tdown").click();
  const played = [NEW[2], NEW[1], NEW[0]];
  await expect(prompts(page)).toHaveText(played.map(t => t.prompt));
  await expect(items(page).first().locator(".tup")).toBeDisabled();
  await expect(items(page).last().locator(".tdown")).toBeDisabled();

  await page.locator("#arrivalEdit").fill("Welcome to the temple. Look closely.");
  await expect(page.locator("#exportInfo")).toContainText("17 challenges");
  const html = await exportGame(page);
  expect(html).not.toContain("Heavenly Happiness");
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
    await phonePage.locator("#stageBtn").click();
    for (const [i, t] of played.entries()) {
      await expect(phonePage.locator("#sheetplace")).toHaveText(`challenge ${i + 1} of 3`);
      await expect(phonePage.locator("#prompt")).toHaveText(t.prompt);
      if (t.type === "multiple_choice") await phonePage.locator(".opt").nth(t.answer).click();
      else await phonePage.locator("#answerInput").fill(t.type === "text" ? t.accept[1] : String(t.answer));
      await phonePage.locator("#stageBtn").click();
    }
    await expect(phonePage.locator("#summary")).toHaveText("You've finished this location.");
    const saved = await phonePage.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt:chinatown-historical-hunt")).progress.answers);
    expect(Object.values(saved).map(a => a.correct)).toEqual([true, true, true]);
    done();
  } finally {
    await phone.close();
  }
});

test("editing a challenge keeps its place and id; Cancel changes nothing", async ({ page }) => {
  const draftIds = () => page.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt-m1:draft")).game.locations.find(l => l.id === "thian-hock-keng").tasks.map(t => t.id));

  await items(page).nth(1).locator(".tedit").click();
  await expect(page.locator("#tfTitle")).toHaveText("Edit challenge 2");
  await expect(page.locator("#tfType")).toHaveValue(THK.tasks[1].type);
  await expect(page.locator("#tfAnswer")).toHaveValue(String(THK.tasks[1].answer));
  await page.locator("#tfPrompt").fill("Count the lions. Carefully.");
  await page.locator("#tfCancel").click();
  await expect(prompts(page).nth(1)).toHaveText(THK.tasks[1].prompt);

  await items(page).nth(1).locator(".tedit").click();
  await page.locator("#tfPrompt").fill("Count the lions. Carefully.");
  await page.locator("#tfHint").fill("");
  await page.locator("#tfSave").click();
  await expect(prompts(page).nth(1)).toHaveText("Count the lions. Carefully.");
  await expect(items(page).nth(1).locator(".tpts")).toHaveText("");
  await expect(page.locator("#tfPoints, #tfHintPenalty")).toHaveCount(0);
  expect(await draftIds()).toEqual(THK.tasks.map(t => t.id));
});

test("an incomplete challenge can't be saved, and the form says what's missing", async ({ page }) => {
  await page.locator("#taskAdd").click();
  await page.locator("#tfPrompt").fill("Which way is the sea?");
  await page.locator(".optrow .tfOpt").nth(0).fill("East");
  await page.locator(".optrow .tfOpt").nth(1).fill("West");
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toHaveText("Can't save yet: mark the correct option");
  await expect(items(page)).toHaveCount(THK.tasks.length);

  await page.locator("#tfType").selectOption("text");
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toHaveText("Can't save yet: add at least one accepted answer");

  await page.locator("#tfType").selectOption("number");
  await page.locator("#tfAnswer").fill("east");
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toHaveText("Can't save yet: the answer must be a number");
});

test("export is blocked while any challenge has a problem, and the panel lists it", async ({ page }) => {
  await page.evaluate(() => {
    const k = "chinatown-hunt-m1:draft";
    const d = JSON.parse(localStorage.getItem(k)) || { savedAt: Date.now(), game: null };
    if (!d.game) throw new Error("no draft yet");
    d.game.locations.find(l => l.id === "amoy-street").tasks[0].accept = [];
    localStorage.setItem(k, JSON.stringify(d));
  }).catch(async () => {
    // No draft yet: make one by editing arrival text, then corrupt it.
    await page.locator("#arrivalEdit").fill(THK.arrivalText + " ");
    await page.evaluate(() => {
      const k = "chinatown-hunt-m1:draft", d = JSON.parse(localStorage.getItem(k));
      d.game.locations.find(l => l.id === "amoy-street").tasks[0].accept = [];
      localStorage.setItem(k, JSON.stringify(d));
    });
  });
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await admin.openTools();
  await expect(page.locator("#exportGame")).toBeDisabled();
  await expect(page.locator("#exportInfo")).toHaveText("Fix this before exporting:\n• Amoy Street, challenge 1: add at least one accepted answer");

  await page.locator("#capTarget").selectOption("amoy-street");
  await expect(items(page).first()).toHaveClass(/\bbad\b/);
  await items(page).first().locator(".tedit").click();
  await page.locator("#tfAccept").fill("Xiamen");
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
