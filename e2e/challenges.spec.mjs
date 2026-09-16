// Playing a location's challenges, as a participant on a phone, with the participant file.
// No points and no right/wrong are ever shown: scoring happens in LoQuiz.
import { readFileSync } from "node:fs";
import { test, expect, offset, pickArrival, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";
import { Pack } from "../src/pack.js";

const PLAY_FILE = new URL("../dist/chinatown-hunt.html", import.meta.url);
const THK = GAME.locations.find(l => l.id === "thian-hock-keng");   // 3 challenges: multiple choice, number, text
const [MC, NUM, TXT] = THK.tasks;

// A route into Thian Hock Keng that stays clear of every other geofence.
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);

async function arriveAt(app, loc = THK, approach = route.approach) {
  await app.begin(far(GAME.locations));
  for (const p of approach) await app.fix(p);
  for (let i = 0; i < 3; i++) await app.fix(offset(loc, 1, i * 120));
}
async function answer(page, task, response) {
  if (task.type === "multiple_choice") await page.locator(".opt").nth(response).click();
  else await page.locator("#answerInput").fill(String(response));
  await page.locator("#stageBtn").click();
}
// Nothing on screen may hint at scoring or at whether an answer was right,
// and no placeholder may leak through as text.
async function expectNoVerdict(page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\bpoints?\b|\bcorrect\b|not quite|\bwrong\b|\bscore\b/i);
  expect(text).not.toMatch(/\bnull\b|\bundefined\b|\[object /);
}

test("arrival text first, then each challenge in order, one answer each, then a summary; no verdicts", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  const place = page.locator("#sheetplace"), btn = page.locator("#stageBtn");

  await expect(page.locator("#sheetname")).toHaveText(THK.name);
  await expect(place).toHaveText("you have arrived");
  await expect(page.locator("#sheettext")).toHaveText(THK.arrivalText);
  await btn.click();                                             // Start the challenges

  // 1: multiple choice, answered right. Straight on to 2, with only a neutral note.
  await expect(place).toHaveText("challenge 1 of 3");
  await expectNoVerdict(page);
  await expect(page.locator("#prompt")).toHaveText(MC.prompt);
  await expect(page.locator(".opt")).toHaveText(MC.options);
  await expect(btn, "can't submit without choosing").toBeDisabled();
  await answer(page, MC, MC.answer);
  await expect(place).toHaveText("challenge 2 of 3");
  await expect(page.locator("#savedNote")).toHaveText("Answer saved.");
  await expectNoVerdict(page);

  // 2: number, answered wrong. It looks exactly the same.
  await expect(page.locator("#prompt")).toHaveText(NUM.prompt);
  await answer(page, NUM, NUM.answer + 5);
  await expect(place).toHaveText("challenge 3 of 3");
  await expect(page.locator("#savedNote")).toHaveText("Answer saved.");
  await expectNoVerdict(page);

  // 3: typed text.
  await answer(page, TXT, `  ${TXT.accept[0].toUpperCase()}!! `);
  await expect(place).toHaveText("location complete");
  await expect(page.locator("#summary")).toHaveText("You've finished this location.");
  await expectNoVerdict(page);
  await btn.click();                                             // Back to the map
  await expect(page.locator("#sheet")).not.toHaveClass(/\bup\b/);
  await expect(page.locator("#reached")).toHaveText("1");
  await expect(page.locator(`.pin[data-id="${THK.id}"]`)).toHaveClass(/\breached\b/);
  await expectNoVerdict(page);

  // Right and wrong were recorded, just never shown.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("chinatown-hunt:chinatown-historical-hunt")).progress.answers);
  expect([saved[MC.id].correct, saved[NUM.id].correct, saved[TXT.id].correct]).toEqual([true, false, true]);
});

test("a hint is free, stays revealed after a reload, and can't be hidden again", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#stageBtn").click();

  await expect(page.locator("#hintBtn")).toHaveText("Show hint");
  await page.locator("#hintBtn").click();
  await expect(page.locator("#hintText")).toHaveText(`Hint: ${MC.hint}`);
  await expectNoVerdict(page);

  await page.reload();
  await page.locator("#startBtn").click();
  await expect(page.locator("#hintText")).toBeVisible();
  await expect(page.locator("#hintBtn")).toHaveCount(0);
});

test("a reload mid-location goes back to the next unanswered challenge", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#stageBtn").click();
  await answer(page, MC, (MC.answer + 1) % MC.options.length);

  await page.reload();
  await expect(page.locator("#startBtn")).toHaveText("Continue");
  await page.locator("#startBtn").click();
  await expect(page.locator("#sheetname")).toHaveText(THK.name);
  await expect(page.locator("#sheetplace")).toHaveText("challenge 2 of 3");
  await expect(page.locator("#prompt")).toHaveText(NUM.prompt);
});

test("no leaving: while a location is open, no other location opens and the sheet can't be closed", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#stageBtn").click();
  await expect(page.locator("#sheet button", { hasText: /back to the map|close/i })).toHaveCount(0);

  // Walk away and stand in another location's geofence for a good while.
  const others = GAME.locations.filter(l => l !== THK);
  const other = pickArrival([...others, THK]);
  for (let i = 0; i < 6; i++) await app.fix(offset(other.loc, 1, i * 60));
  await expect(page.locator("#sheetname")).toHaveText(THK.name);
  await expect(page.locator(`.pin[data-id="${other.loc.id}"]`)).not.toHaveClass(/\b(active|reached)\b/);
  await expect(page.locator("#override")).toBeHidden();
  await expect(page.locator("#target")).toHaveText(THK.name);

  // Finish Thian Hock Keng from where they are; then the other location opens on the next fixes.
  await answer(page, MC, MC.answer);
  await answer(page, NUM, NUM.answer);
  await answer(page, TXT, TXT.accept[0]);
  await page.locator("#stageBtn").click();                       // Back to the map
  for (let i = 0; i < 3; i++) await app.fix(offset(other.loc, 1, i * 90));
  await expect(page.locator("#sheetname")).toHaveText(other.loc.name);
  await expect(page.locator("#sheetplace")).toHaveText("you have arrived");
});

test("a re-uploaded game keeps progress: a reworded question and an added challenge", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#stageBtn").click();
  await answer(page, MC, MC.answer);
  await expect(page.locator("#sheetplace")).toHaveText("challenge 2 of 3");

  // The organiser rewords challenge 2 and inserts a new challenge before it, then re-uploads.
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  thk.tasks[1].prompt = "How many stone lions guard the entrance?";
  thk.tasks.splice(1, 0, { id: "t-new-00001", type: "text", prompt: "Name the temple's sea goddess.", accept: ["mazu"] });
  const html = readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);
  await app.open({ file: "play", html });

  await expect(page.locator("#startBtn")).toHaveText("Continue");
  await page.locator("#startBtn").click();
  await expect(page.locator("#sheetplace")).toHaveText("challenge 2 of 4");
  await expect(page.locator("#prompt")).toHaveText("Name the temple's sea goddess.");
  await answer(page, thk.tasks[1], "Mazu");
  await expect(page.locator("#prompt")).toHaveText("How many stone lions guard the entrance?");
});

test("a challenge with no hint and no picture shows neither, and no stray text", async ({ app, page }) => {
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  for (const t of thk.tasks) delete t.hint;
  const html = readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);
  await app.open({ file: "play", html });
  await arriveAt(app);
  await expectNoVerdict(page);
  await page.locator("#stageBtn").click();
  await expect(page.locator("#prompt")).toHaveText(MC.prompt);
  await expect(page.locator("#hintBtn, #hintText, #stage figure")).toHaveCount(0);
  await expect(page.locator("#stage")).not.toContainText("null");
  await expectNoVerdict(page);
  await answer(page, MC, 0);
  await expectNoVerdict(page);
});

test("line breaks typed by the organiser are kept on every screen", async ({ app, page }) => {
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  thk.arrivalText = "First paragraph.\n\nSecond paragraph,\nwith a second line.";
  thk.tasks[0].prompt = "Line one of the question.\nLine two.";
  thk.tasks[0].hint = "Hint line one.\nHint line two.";
  game.clues[0].text = "Clue line one.\nClue line two.";
  game.suspects[0].blurb = "Blurb one.\nBlurb two.";
  game.locations = [thk];                                        // finishing the only location brings the clues forward
  const html = readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);
  await app.open({ file: "play", html, pins: 1 });
  await app.begin(far(GAME.locations));
  for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
  const lines = locator => locator.evaluate(el => el.innerText.split("\n"));

  expect(await lines(page.locator("#sheettext"))).toEqual(["First paragraph.", "", "Second paragraph,", "with a second line."]);
  await page.locator("#stageBtn").click();
  expect(await lines(page.locator("#prompt"))).toEqual(["Line one of the question.", "Line two."]);
  await page.locator("#hintBtn").click();
  expect(await lines(page.locator("#hintText"))).toEqual(["Hint: Hint line one.", "Hint line two."]);

  await answer(page, MC, 0);
  await answer(page, NUM, 1);
  await answer(page, TXT, "x");
  await page.locator("#stageBtn").click();                       // See the clues
  expect(await lines(page.locator("#clueList li p").first())).toEqual(["Clue line one.", "Clue line two."]);
  expect(await lines(page.locator("#suspectList li span").first())).toEqual(["Blurb one.", "Blurb two."]);
});
