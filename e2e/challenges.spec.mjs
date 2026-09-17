// A location's challenges, as a participant on a phone, with the participant file.
// Nothing is answered here: teams read each challenge (text and picture) and answer in LoQuiz.
import { readFileSync } from "node:fs";
import { test, expect, offset, pickArrival, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";
import { Pack } from "../src/pack.js";

const PLAY_FILE = new URL("../dist/chinatown-hunt.html", import.meta.url);
const THK = GAME.locations.find(l => l.id === "thian-hock-keng");   // 3 challenges
const [C1, C2, C3] = THK.tasks;

// A route into Thian Hock Keng that stays clear of every other geofence.
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);
const playHtml = game => readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);

async function arriveAt(app, loc = THK, approach = route.approach) {
  await app.begin(far(GAME.locations));
  for (const p of approach) await app.fix(p);
  for (let i = 0; i < 3; i++) await app.fix(offset(loc, 1, i * 120));
}
// Nothing on screen may invite an answer or mention scoring, and no placeholder may leak through as text.
async function expectReadOnly(page) {
  await expect(page.locator("#sheet input, #sheet textarea, #sheet select, .opt, #hintBtn")).toHaveCount(0);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\bpoints?\b|\bcorrect\b|\bwrong\b|\bscore\b|\bsubmit\b|\bhint\b/i);
  expect(text).not.toMatch(/\bnull\b|\bundefined\b|\[object /);
}
const place = page => page.locator("#sheetplace");

test("arrival text, then each challenge with Next and Back, then Finish location on the last", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);

  await expect(page.locator("#sheetname")).toHaveText(THK.name);
  await expect(place(page)).toHaveText("you have arrived");
  await expect(page.locator("#sheettext")).toHaveText(THK.arrivalText);
  await expect(page.locator("#stage .small")).toHaveText("3 challenges here. Answer them in LoQuiz, then finish this location before moving on.");
  await expect(page.locator("#backBtn")).toHaveCount(0);
  await expectReadOnly(page);
  await page.locator("#nextBtn").click();                        // Start the challenges

  await expect(place(page)).toHaveText("challenge 1 of 3");
  await expect(page.locator("#prompt")).toHaveText(C1.prompt);
  await expect(page.locator("#finishBtn")).toHaveCount(0);
  await expectReadOnly(page);
  await page.locator("#nextBtn").click();

  await expect(place(page)).toHaveText("challenge 2 of 3");
  await expect(page.locator("#prompt")).toHaveText(C2.prompt);
  await page.locator("#backBtn").click();                        // re-read the first
  await expect(place(page)).toHaveText("challenge 1 of 3");
  await page.locator("#backBtn").click();                        // and the arrival text
  await expect(place(page)).toHaveText("you have arrived");
  await page.locator("#nextBtn").click();
  await page.locator("#nextBtn").click();
  await page.locator("#nextBtn").click();

  await expect(place(page)).toHaveText("challenge 3 of 3");
  await expect(page.locator("#nextBtn")).toHaveCount(0);
  await expect(page.locator("#finishBtn")).toHaveText("Finish location");
  await expectReadOnly(page);
  await page.locator("#finishBtn").click();

  await expect(page.locator("#sheet")).not.toHaveClass(/\bup\b/);
  await expect(page.locator("#reached")).toHaveText("1");
  await expect(page.locator(`.pin[data-id="${THK.id}"]`)).toHaveClass(/\breached\b/);
  await expectReadOnly(page);
});

test("a reload mid-location comes back to the same challenge", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#nextBtn").click();
  await page.locator("#nextBtn").click();
  await expect(place(page)).toHaveText("challenge 2 of 3");

  await page.reload();
  await expect(page.locator("#startBtn")).toHaveText("Continue");
  await page.locator("#startBtn").click();
  await expect(page.locator("#sheetname")).toHaveText(THK.name);
  await expect(place(page)).toHaveText("challenge 2 of 3");
  await expect(page.locator("#prompt")).toHaveText(C2.prompt);
});

test("no leaving: while a location is open, no other location opens and the sheet can't be closed", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#nextBtn").click();
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
  await page.locator("#nextBtn").click();
  await page.locator("#nextBtn").click();
  await page.locator("#finishBtn").click();
  for (let i = 0; i < 3; i++) await app.fix(offset(other.loc, 1, i * 90));
  await expect(page.locator("#sheetname")).toHaveText(other.loc.name);
  await expect(place(page)).toHaveText("you have arrived");
});

test("a location with no challenges shows its arrival text and Finish location", async ({ app, page }) => {
  const game = structuredClone(GAME);
  game.locations.find(l => l.id === THK.id).tasks = [];
  await app.open({ file: "play", html: playHtml(game) });
  await arriveAt(app);
  await expect(page.locator("#sheettext")).toHaveText(THK.arrivalText);
  await expect(page.locator("#stage .small")).toHaveCount(0);
  await expect(page.locator("#nextBtn, #backBtn")).toHaveCount(0);
  await page.locator("#finishBtn").click();
  await expect(page.locator("#reached")).toHaveText("1");
});

test("a picture-only challenge shows just the picture", async ({ app, page }) => {
  const game = structuredClone(GAME);
  game.locations.find(l => l.id === THK.id).tasks[0] = { id: C1.id, prompt: "", image: "https://img.test/hunt/only.png" };
  await app.open({ file: "play", html: playHtml(game) });
  await arriveAt(app);
  await page.locator("#nextBtn").click();
  await expect(page.locator("#stage figure.qimg img")).toHaveAttribute("src", "https://img.test/hunt/only.png");
  await expect(page.locator("#prompt")).toHaveCount(0);
  await expectReadOnly(page);
});

test("a re-uploaded game keeps progress: a reworded challenge and an added one", async ({ app, page }) => {
  await app.open({ file: "play" });
  await arriveAt(app);
  await page.locator("#nextBtn").click();
  await page.locator("#nextBtn").click();
  await expect(place(page)).toHaveText("challenge 2 of 3");

  // The organiser rewords challenge 2 and adds a fourth, then re-uploads.
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  thk.tasks[1].prompt = "How many stone lions guard the entrance?";
  thk.tasks.push({ id: "t-new-00001", prompt: "Name the temple's sea goddess." });
  await app.open({ file: "play", html: playHtml(game) });

  await page.locator("#startBtn").click();
  await expect(place(page)).toHaveText("challenge 2 of 4");
  await expect(page.locator("#prompt")).toHaveText("How many stone lions guard the entrance?");
  await page.locator("#nextBtn").click();
  await page.locator("#nextBtn").click();
  await expect(page.locator("#prompt")).toHaveText("Name the temple's sea goddess.");
  await expect(page.locator("#finishBtn")).toBeVisible();
});

test("line breaks typed by the organiser are kept on every screen", async ({ app, page }) => {
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  thk.arrivalText = "First paragraph.\n\nSecond paragraph,\nwith a second line.";
  thk.tasks = [{ id: C1.id, prompt: "Line one of the challenge.\nLine two." }];
  game.clues[0].text = "Clue line one.\nClue line two.";
  game.suspects[0].blurb = "Blurb one.\nBlurb two.";
  game.locations = [thk];                                        // finishing the only location brings the clues forward
  await app.open({ file: "play", html: playHtml(game), pins: 1 });
  await app.begin(far(GAME.locations));
  for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
  const lines = locator => locator.evaluate(el => el.innerText.split("\n"));

  expect(await lines(page.locator("#sheettext"))).toEqual(["First paragraph.", "", "Second paragraph,", "with a second line."]);
  await page.locator("#nextBtn").click();
  expect(await lines(page.locator("#prompt"))).toEqual(["Line one of the challenge.", "Line two."]);
  await expect(page.locator("#finishBtn")).toHaveText("Finish location and see the clues");
  await page.locator("#finishBtn").click();
  expect(await lines(page.locator("#clueList li p").first())).toEqual(["Clue line one.", "Clue line two."]);
  expect(await lines(page.locator("#suspectList li span").first())).toEqual(["Blurb one.", "Blurb two."]);
});

test("an open location fills the screen; the buttons stay in reach under long text", async ({ app, page }) => {
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  thk.tasks[0] = { id: C1.id, prompt: Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long challenge.`).join("\n"),
    image: "https://img.test/hunt/tall.png" };
  await app.open({ file: "play", html: playHtml(game) });
  await arriveAt(app);
  await page.locator("#nextBtn").click();
  await expect(page.locator("#sheet")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  const vp = page.viewportSize();
  const sheet = await page.locator("#sheet").boundingBox();
  expect(sheet).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });
  // Nothing of the map or the map screen shows through.
  for (const sel of ["#map", "#hud", "#strip"]) {
    const covered = await page.locator(sel).evaluate(el => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = Math.min(r.top + r.height / 2, innerHeight - 1);
      return document.elementFromPoint(x, y)?.closest("#sheet") != null;
    });
    expect(covered, `${sel} is covered`).toBe(true);
  }
  // The text runs past the bottom, but Next is on screen and usable.
  expect(await page.locator("#sheet").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(page.locator("#nextBtn")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#backBtn")).toBeInViewport({ ratio: 1 });
  await page.locator("#nextBtn").click();
  await expect(place(page)).toHaveText("challenge 2 of 3");
  await expect(page.locator("#prompt")).toBeInViewport();          // the next challenge starts at the top

  // Back on the map once finished.
  await page.locator("#nextBtn").click();
  await page.locator("#finishBtn").click();
  await expect(page.locator("#map")).toBeInViewport();
  await expect(page.locator("#hud")).toBeInViewport();
});

test("links in the organiser's text open in a new tab and leave the game where it was", async ({ app, page, context }) => {
  await context.route("https://history.test/**", r => r.fulfill({ contentType: "text/html", body: "<h1>History</h1>" }));
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  thk.arrivalText = "Read [the temple's story](https://history.test/thk) before you start.";
  thk.tasks[0] = { id: C1.id, prompt: "Look at [this plaque](https://history.test/plaque) and [this](javascript:alert(1)).\nThen answer in LoQuiz." };
  game.clues[0].text = "See [the ledger](https://history.test/ledger).";
  game.suspects[0].blurb = "Profile: [Tan](https://history.test/tan).";
  await app.open({ file: "play", html: playHtml(game) });
  await arriveAt(app);

  const story = page.locator("#sheettext a");
  await expect(story).toHaveText("the temple's story");
  await expect(story).toHaveAttribute("href", "https://history.test/thk");
  await expect(story).toHaveAttribute("target", "_blank");
  await expect(story).toHaveAttribute("rel", "noopener noreferrer");
  expect(await page.locator("#sheettext").evaluate(el => el.innerText)).toBe("Read the temple's story before you start.");
  expect(await story.evaluate(a => getComputedStyle(a, "::after").content)).toBe('" ↗"');   // marked as opening elsewhere

  await page.locator("#nextBtn").click();
  await expect(page.locator("#prompt a")).toHaveCount(1);              // the javascript: one stays plain text
  await expect(page.locator("#prompt a")).toHaveText("this plaque");
  await expect(page.locator("#prompt")).toContainText("[this](javascript:alert(1))");
  expect(await page.locator("#prompt").evaluate(el => el.innerText.split("\n")[1])).toBe("Then answer in LoQuiz.");

  const [tab] = await Promise.all([context.waitForEvent("page"), page.locator("#prompt a").click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toBe("https://history.test/plaque");
  await expect(page.locator("#sheetplace"), "the game is still on the same challenge").toHaveText("challenge 1 of 3");
  expect(page.url()).toContain("chinatown-hunt.html");

  // Links on the clues screen too.
  for (let i = 0; i < 2; i++) await page.locator("#nextBtn").click();
  await page.locator("#finishBtn").click();
  await page.evaluate(() => {
    const k = "chinatown-hunt:chinatown-historical-hunt", d = JSON.parse(localStorage.getItem(k));
    d.progress.revealed = true; localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload();
  await page.locator("#startBtn").click();
  await expect(page.locator("#clueList li").first().locator("a")).toHaveAttribute("href", "https://history.test/ledger");
  await expect(page.locator("#suspectList li").first().locator("span a")).toHaveAttribute("href", "https://history.test/tan");
});
