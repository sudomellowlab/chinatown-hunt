// Playing a location's challenges, as a participant on a phone, with the participant file.
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
const sheet = page => ({
  place: page.locator("#sheetplace"), name: page.locator("#sheetname"), prompt: page.locator("#prompt"),
  btn: page.locator("#stageBtn"), feedback: page.locator("#feedback"),
});
async function answer(page, task, response) {
  if (task.type === "multiple_choice") await page.locator(".opt").nth(response).click();
  else await page.locator("#answerInput").fill(String(response));
  await page.locator("#stageBtn").click();
}

test("arrival text first, then each challenge in order, one answer each, then a summary", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  const s = sheet(page);

  await expect(s.name).toHaveText(THK.name);
  await expect(s.place).toHaveText("you have arrived");
  await expect(page.locator("#sheettext")).toHaveText(THK.arrivalText);
  await expect(s.btn).toHaveText("Start the challenges");
  await s.btn.click();

  // 1: multiple choice, right.
  await expect(s.place).toHaveText("challenge 1 of 3");
  await expect(s.prompt).toHaveText(MC.prompt);
  await expect(page.locator(".opt")).toHaveText(MC.options);
  await expect(s.btn, "can't submit without choosing").toBeDisabled();
  await answer(page, MC, MC.answer);
  await expect(s.feedback).toHaveText(`Correct! +${MC.points} points`);
  await expect(page.locator(".opt"), "no second try").toHaveCount(0);
  await expect(page.locator("#score")).toHaveText(String(MC.points));
  await s.btn.click();

  // 2: number, wrong.
  await expect(s.place).toHaveText("challenge 2 of 3");
  await expect(s.prompt).toHaveText(NUM.prompt);
  await answer(page, NUM, NUM.answer + 5);
  await expect(s.feedback).toHaveText("Not quite. 0 points.");
  await expect(page.locator("#answerInput"), "no second try").toHaveCount(0);
  await s.btn.click();

  // 3: typed text, right despite case, spacing and punctuation.
  await expect(s.place).toHaveText("challenge 3 of 3");
  await answer(page, TXT, `  ${TXT.accept[0].toUpperCase()}!! `);
  await expect(s.feedback).toHaveText(`Correct! +${TXT.points} points`);
  await expect(s.btn).toHaveText("See your score");
  await s.btn.click();

  const total = MC.points + TXT.points;
  await expect(s.place).toHaveText("location complete");
  await expect(page.locator("#summary")).toHaveText(`2 of 3 right · ${total} points here`);
  await s.btn.click();                                           // Back to the map
  await expect(page.locator("#sheet")).not.toHaveClass(/\bup\b/);
  await expect(page.locator("#score")).toHaveText(String(total));
  await expect(page.locator("#reached")).toHaveText("1");
  await expect(page.locator(`.pin[data-id="${THK.id}"]`)).toHaveClass(/\breached\b/);
});

test("a hint costs points and can't be taken back; the challenge is still worth the rest", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#stageBtn").click();

  await expect(page.locator(".small").first()).toHaveText(`Worth ${MC.points} points. One try only.`);
  await page.locator("#hintBtn").click();
  await expect(page.locator("#hintText")).toHaveText(`Hint: ${MC.hint}`);
  await expect(page.locator(".small").first()).toHaveText(`Worth ${MC.points - MC.hintPenalty} points. One try only.`);

  await page.reload();                                           // the hint stays revealed, and paid for
  await page.locator("#startBtn").click();
  await expect(page.locator("#hintText")).toBeVisible();
  await expect(page.locator("#hintBtn")).toHaveCount(0);

  await answer(page, MC, MC.answer);
  await expect(page.locator("#feedback")).toHaveText(`Correct! +${MC.points - MC.hintPenalty} points`);
});

test("a reload mid-location goes back to the next unanswered challenge", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#stageBtn").click();
  await answer(page, MC, (MC.answer + 1) % MC.options.length);   // wrong, and final

  await page.reload();
  await expect(page.locator("#startBtn")).toHaveText("Continue");
  await page.locator("#startBtn").click();
  await expect(page.locator("#sheetname")).toHaveText(THK.name);
  await expect(page.locator("#sheetplace")).toHaveText("challenge 2 of 3");
  await expect(page.locator("#prompt")).toHaveText(NUM.prompt);
  await expect(page.locator("#score")).toHaveText("0");
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
  await answer(page, MC, MC.answer); await page.locator("#stageBtn").click();
  await answer(page, NUM, NUM.answer); await page.locator("#stageBtn").click();
  await answer(page, TXT, TXT.accept[0]); await page.locator("#stageBtn").click();
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
  await expect(page.locator("#score")).toHaveText(String(MC.points));

  // The organiser rewords challenge 2 and inserts a new challenge before it, then re-uploads.
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  thk.tasks[1].prompt = "How many stone lions guard the entrance?";
  thk.tasks.splice(1, 0, { id: "t-new-00001", type: "text", prompt: "Name the temple's sea goddess.", accept: ["mazu"], points: 60 });
  const html = readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);
  await app.open({ file: "play", html });

  await expect(page.locator("#startBtn")).toHaveText("Continue");
  await page.locator("#startBtn").click();
  await expect(page.locator("#score")).toHaveText(String(MC.points));
  await expect(page.locator("#sheetplace")).toHaveText("challenge 2 of 4");
  await expect(page.locator("#prompt")).toHaveText("Name the temple's sea goddess.");
  await answer(page, thk.tasks[1], "Mazu");
  await page.locator("#stageBtn").click();
  await expect(page.locator("#prompt")).toHaveText("How many stone lions guard the entrance?");
});
