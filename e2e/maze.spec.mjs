// A maze on a challenge: built from a sentence in the admin panel, traced with a finger on a phone.
// Each square of the route shows its letter; reaching the end finishes the challenge.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, offset, pickArrival, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

const THK = GAME.locations.find(l => l.id === "thian-hock-keng");
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);
const SENTENCE = "Sang Nila Utama reigned over it";
const LETTERS = "SangNilaUtamareignedoverit";

async function exportGame(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return readFileSync(await dl.path(), "utf8");
}
/* Build a maze on the temple's first challenge, export the game, and read the maze back out of
   the admin panel's own draft — the game file keeps the route to itself, as it should. */
async function mazeGame(app, page, sentence = SENTENCE) {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await page.locator("#taskList li").first().locator(".tedit").click();
  await page.locator("#tfMazeSentence").fill(sentence);
  await page.locator("#tfMazeMake").click();
  await expect(page.locator("#tfMazeInfo")).toContainText("squares");
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskForm")).toBeHidden();
  const html = await exportGame(page);
  const maze = await page.evaluate(id => {
    const draft = JSON.parse(localStorage.getItem("chinatown-hunt-m1:draft"));
    return draft.game.locations.find(l => l.id === id).tasks[0].maze;
  }, THK.id);
  return { html, maze };
}
// Play it on a phone, standing at the temple, on the challenge that has the maze.
async function atTheMaze(browser, html, fn) {
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await phone.newPage();
    const { app, done } = await createApp({ page, context: phone });
    await app.open({ html });
    await app.begin(far(GAME.locations));
    for (const p of route.approach) await app.fix(p);
    for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
    await page.locator("#nextBtn").click();
    await expect(page.locator("#mazeGrid")).toBeVisible();
    await fn(page, app);
    done();
  } finally {
    await phone.close();
  }
}
// Drag a finger through the middle of each square in turn.
async function trace(page, maze, cells) {
  const box = await page.locator("#mazeGrid").boundingBox();
  const point = cell => ({
    x: box.x + ((cell % maze.cols) + 0.5) * (box.width / maze.cols),
    y: box.y + (Math.floor(cell / maze.cols) + 0.5) * (box.height / maze.rows),
  });
  const first = point(cells[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const cell of cells.slice(1)) {
    const p = point(cell);
    await page.mouse.move(p.x, p.y, { steps: 3 });
  }
  await page.mouse.up();
}

test("a maze is built from a sentence, traced on a phone, and finishes the challenge", async ({ app, page, browser }) => {
  const { html, maze } = await mazeGame(app, page);
  await expect(page.locator("#taskList li").first().locator(".tpts")).toContainText(`maze, ${LETTERS.length} letters`);
  expect(maze.letters).toBe(LETTERS);
  // The sentence travels sealed, like the rest of the game.
  for (const secret of [SENTENCE, LETTERS]) expect(html).not.toContain(secret);

  await atTheMaze(browser, html, async (phone) => {
    // Nothing is given away before they start.
    await expect(phone.locator("#mazeLetters text")).toHaveCount(0);
    await expect(phone.locator("#mazeSays")).toHaveText("Start on the marked square and drag along the route.");
    await expect(phone.locator("#mazeStart")).toBeVisible();
    await expect(phone.locator("#nextBtn")).toBeDisabled();

    // The first few squares of the route reveal their letters.
    await trace(phone, maze, maze.path.slice(0, 5));
    await expect(phone.locator("#mazeLetters text")).toHaveCount(5);
    expect(await phone.locator("#mazeLetters text").allTextContents()).toEqual([...LETTERS.slice(0, 5)]);
    await expect(phone.locator("#mazeSays")).toHaveText(`5 of ${maze.path.length} squares`);
    await expect(phone.locator("#nextBtn")).toBeDisabled();
    await expect(phone.locator("#mazeStart")).toBeHidden();

    // A square off the route does nothing at all: pressed on its own, so nothing is crossed.
    const offRoute = [...Array(maze.cols * maze.rows).keys()].find(c => !maze.path.includes(c));
    await trace(phone, maze, [offRoute]);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(5);

    // Dragging back the way they came rubs the last letter out.
    await trace(phone, maze, [maze.path[4], maze.path[3]]);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(4);

    // The whole route: the sentence appears and Next opens.
    await trace(phone, maze, maze.path);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(maze.path.length);
    expect(await phone.locator("#mazeLetters text").allTextContents()).toEqual([...LETTERS]);
    await expect(phone.locator("#mazeSays")).toHaveText(SENTENCE);
    await expect(phone.locator("#nextBtn")).toBeEnabled();

    // It stays done after a reload.
    await phone.reload();
    await phone.locator("#startBtn").click();
    await expect(phone.locator("#mazeSays")).toHaveText(SENTENCE);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(maze.path.length);
    await expect(phone.locator("#nextBtn")).toBeEnabled();
  });
});

test("the maze is drawn with walls, and the route is the only way through", async ({ app, page, browser }) => {
  const { html, maze } = await mazeGame(app, page, "Teri Buana of the three worlds");

  await atTheMaze(browser, html, async (phone) => {
    /* Every wall the maze has is drawn: each square's top and left, plus the bottom and right
       edges of the grid. (A wall line has no thickness of its own, so it's counted, not looked at.) */
    const N = 1, E = 2, S = 4, W = 8;
    let expected = 0;
    for (let cell = 0; cell < maze.cols * maze.rows; cell++) {
      const col = cell % maze.cols, row = Math.floor(cell / maze.cols), w = maze.walls[cell];
      if (w & N) expected++;
      if (w & W) expected++;
      if (row === maze.rows - 1 && (w & S)) expected++;
      if (col === maze.cols - 1 && (w & E)) expected++;
    }
    await expect(phone.locator("#mazeGrid .mazewalls line")).toHaveCount(expected);
    expect(expected).toBeGreaterThan(maze.cols * maze.rows);
    const viewBox = await phone.locator("#mazeGrid").getAttribute("viewBox");
    expect(viewBox).toBe(`-0.6 -0.6 ${maze.cols * 10 + 1.2} ${maze.rows * 10 + 1.2}`);

    // Starting anywhere but the marked square gets nowhere.
    const notTheStart = [...Array(maze.cols * maze.rows).keys()].find(c => c !== maze.path[0]);
    await trace(phone, maze, [notTheStart]);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(0);

    // Skipping ahead doesn't work either: the second square is no good without the first.
    await trace(phone, maze, [maze.path[1], maze.path[2]]);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(0);
    await expect(phone.locator("#nextBtn")).toBeDisabled();
  });
});

test("the sentence must make a maze, and a challenge can't have both a maze and an answer", async ({ app, page }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await page.locator("#taskList li").first().locator(".tedit").click();

  await expect(page.locator("#tfMazeInfo")).toContainText("No maze.");
  await expect(page.locator("#tfMazeAnother")).toBeHidden();
  await page.locator("#tfMazeSentence").fill("Hi!");
  await page.locator("#tfMazeMake").click();
  await expect(page.locator("#tfMazeInfo")).toContainText("at least 4 letters");
  await expect(page.locator("#tfMazePrev svg")).toHaveCount(0);

  await page.locator("#tfMazeSentence").fill(SENTENCE);
  await page.locator("#tfMazeMake").click();
  await expect(page.locator("#tfMazePrev svg")).toHaveCount(1);
  await expect(page.locator("#tfMazePrev text")).toHaveCount(LETTERS.length);

  // Changing the sentence afterwards says the maze is out of date.
  await page.locator("#tfMazeSentence").fill("Something else entirely");
  await expect(page.locator("#tfMazeInfo")).toContainText("Make the maze again");
  await page.locator("#tfMazeMake").click();
  await expect(page.locator("#tfMazeInfo")).toContainText("squares");

  // A maze and an answer on one challenge is refused.
  await page.locator("#tfAnswer select.answerkind").selectOption("text");
  await page.locator("#tfAnswer textarea").fill("something");
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toContainText("a challenge has either a maze or an answer, not both");
  await expect(page.locator("#taskForm")).toBeVisible();

  // Taking the maze off leaves the answer, and saves.
  await page.locator("#tfMazeRemove").click();
  await expect(page.locator("#tfMazePrev svg")).toHaveCount(0);
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskForm")).toBeHidden();
  await expect(page.locator("#taskList li").first().locator(".tpts")).not.toContainText("maze");
  await expect(page.locator("#exportGame")).toBeEnabled();
});
