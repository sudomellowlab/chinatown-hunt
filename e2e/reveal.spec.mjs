// The clues & suspects screen, as a participant on a phone, with the participant file.
// Each team's clock starts at Begin; the screen appears revealMinutes before the end.
import { readFileSync } from "node:fs";
import { test, expect, offset, pickArrival, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";
import { Pack } from "../src/pack.js";

const PLAY_FILE = new URL("../dist/chinatown-hunt.html", import.meta.url);
const MIN = 60_000;
const revealAt = (GAME.durationMinutes - GAME.revealMinutes) * MIN;     // after Begin
const THK = GAME.locations.find(l => l.id === "thian-hock-keng");
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);

const reveal = page => page.locator("#reveal");
async function expectClues(page, game = GAME) {
  await expect(reveal(page)).toBeVisible();
  await expect(page.locator("#clueList li")).toHaveText(game.clues.map(c => c.text));
  await expect(page.locator("#suspectList li strong")).toHaveText(game.suspects.map(s => s.name));
  await expect(page.locator("#suspectList li span")).toHaveText(game.suspects.filter(s => s.blurb).map(s => s.blurb));
  await expect(reveal(page).locator("button, input, select")).toHaveCount(0);   // nothing to pick: no accusation here
}
async function arriveAtTemple(app) {
  for (const p of route.approach) await app.fix(p);
  for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
}

test("the clues appear on the team's own clock, revealMinutes before the end, and stay", async ({ app, page }) => {
  await page.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
  await app.open({ file: "play" });
  await page.clock.fastForward(30 * MIN);                        // time before Begin doesn't count
  await app.begin(far(GAME.locations));

  await page.clock.fastForward(revealAt - 5_000);
  await expect(reveal(page)).toBeHidden();
  await page.clock.fastForward(6_000);
  await expectClues(page);
  await expect(page.locator("#clock")).toHaveText(/^0:19:5\d$/);

  // It stays through a reload, and Continue goes straight back to it.
  await page.reload();
  await expect(page.locator("#startBtn")).toHaveText("Continue");
  await page.locator("#startBtn").click();
  await expectClues(page);
  expect(await app.geoWatches(), "no location needed once the clues are showing").toBe(0);
});

test("once the clues are due, GPS stops and walking into a location opens nothing", async ({ app, page, context }) => {
  await page.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
  await app.open({ file: "play" });
  await app.begin(far(GAME.locations));
  await page.clock.fastForward(revealAt + MIN);
  await expectClues(page);
  const fixesBefore = await page.locator("#fixcount").textContent();

  // Stand inside a location's circle for a while: no fixes are taken and nothing opens.
  for (let i = 0; i < 4; i++) {
    const p = offset(THK, 1, i * 90);
    await context.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: 8 });
    await page.waitForTimeout(250);
  }
  await expect(page.locator("#fixcount")).toHaveText(fixesBefore);
  await expect(page.locator(".pin.active, .pin.reached")).toHaveCount(0);
  await expect(page.locator("#sheet")).not.toHaveClass(/\bup\b/);
});

test("a team part-way through a location finishes it first, then sees the clues", async ({ app, page }) => {
  await page.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
  await app.open({ file: "play" });
  await app.begin(far(GAME.locations));
  await arriveAtTemple(app);
  await page.locator("#nextBtn").click();                        // start the challenges
  await page.locator("#nextBtn").click();                        // on challenge 2

  await page.clock.fastForward(revealAt + MIN);
  await expect(page.locator("#closingNote")).toHaveText("Time is nearly up. Finish this location to see the clues.");
  await expect(page.locator("#sheetplace"), "the team stays where they were").toHaveText("challenge 2 of 3");
  await expect(reveal(page)).toBeHidden();
  await expect(page.locator("#target")).toHaveText(THK.name);

  await page.locator("#nextBtn").click();
  await expect(page.locator("#closingNote")).toBeVisible();
  await expect(page.locator("#finishBtn")).toHaveText("Finish location and see the clues");
  await page.locator("#finishBtn").click();
  await expectClues(page);
});

test("finishing every location brings the clues forward", async ({ app, page }) => {
  // A one-location game makes this quick.
  const game = structuredClone(GAME);
  game.locations = game.locations.filter(l => l.id === THK.id);
  const html = readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);
  await app.open({ file: "play", html, pins: 1 });
  await app.begin(far(GAME.locations));
  for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
  for (let i = 0; i < 3; i++) await page.locator("#nextBtn").click();
  await expect(page.locator("#finishBtn")).toHaveText("Finish location and see the clues");
  await page.locator("#finishBtn").click();
  await expectClues(page, game);
  await expect(page.locator("#clock")).toHaveText(/^1:5\d:\d\d$/);   // well before the reveal time
});

test("the reveal time and the lists come from the game file", async ({ app, page }) => {
  const game = structuredClone(GAME);
  game.durationMinutes = 60; game.revealMinutes = 45;
  game.clues = [{ id: "c-x", text: "Only one clue in this version." }];
  game.suspects = [{ id: "s-x", name: "A. Nonymous", blurb: "" }, { id: "s-y", name: "B. Nobody", blurb: "Was never there." }];
  const html = readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);

  await page.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
  await app.open({ file: "play", html });
  await expect(page.locator("#clock")).toHaveText("1:00:00");
  await app.begin(far(GAME.locations));
  await page.clock.fastForward(14 * MIN);
  await expect(reveal(page)).toBeHidden();
  await page.clock.fastForward(1 * MIN + 1_000);
  await expectClues(page, game);
});

test("once shown, the clues stay even if a re-uploaded game moves the reveal later", async ({ app, page }) => {
  await page.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
  await app.open({ file: "play" });
  await app.begin(far(GAME.locations));
  await page.clock.fastForward(revealAt + MIN);
  await expectClues(page);

  const game = structuredClone(GAME);
  game.revealMinutes = 0;                                        // clues only at the very end now
  const html = readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);
  await app.open({ file: "play", html });
  await page.locator("#startBtn").click();
  await expectClues(page);
});
