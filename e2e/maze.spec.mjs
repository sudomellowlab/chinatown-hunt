// A maze on a challenge: built from a sentence in the admin panel, traced with a finger on a phone.
// Each square of the route shows its letter; reaching the end finishes the challenge.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, offset, pickArrival, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

const THK = GAME.locations.find(l => l.id === "thian-hock-keng");
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);
const SENTENCE = "Sang Nila Utama reigned over it";
const [N, E, S, W] = [1, 2, 4, 8];                    // which side of a square a wall is on
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
    await expect(phone.locator("#mazeSays")).toHaveText("Start at the gold square and find your way out at the bottom.");
    await expect(phone.locator("#mazeStart")).toBeVisible();
    await expect(phone.locator("#nextBtn")).toBeDisabled();

    // Walking the first few squares of the route shows their letters.
    await trace(phone, maze, maze.path.slice(0, 5));
    await expect(phone.locator("#mazeLetters text")).toHaveCount(5);
    await expect(phone.locator("#mazeSays")).toHaveText("Keep going. The way out is at the bottom.");
    await expect(phone.locator("#nextBtn")).toBeDisabled();
    await expect(phone.locator("#mazeStart")).toBeHidden();
    // Nothing marks them out as right: the letters are plain until the end.
    await expect(phone.locator("#mazeLetters text.route")).toHaveCount(0);

    // Through a wall is no way at all.
    const walled = [...Array(maze.cols * maze.rows).keys()].find(c =>
      Math.abs(c - maze.path[4]) === 1 && (maze.walls[maze.path[4]] & (c > maze.path[4] ? E : W)));
    if (walled != null) {
      await trace(phone, maze, [maze.path[4], walled]);
      await expect(phone.locator("#mazeLetters text")).toHaveCount(5);
    }

    // Retreating the way they came rubs the trail out behind them, though the letter stays seen.
    await trace(phone, maze, [maze.path[4], maze.path[3]]);
    await expect(phone.locator("#mazeTrail rect")).toHaveCount(4);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(5);

    // Out at the bottom: the route lights up and the sentence appears.
    await trace(phone, maze, maze.path);
    await expect(phone.locator("#mazeSays")).toHaveText(SENTENCE);
    await expect(phone.locator("#mazeLetters text.route")).toHaveCount(maze.path.length);
    expect(await phone.locator("#mazeLetters text.route").allTextContents()).toEqual([...LETTERS]);
    await expect(phone.locator("#nextBtn")).toBeEnabled();

    // It stays done after a reload.
    await phone.reload();
    await phone.locator("#startBtn").click();
    await expect(phone.locator("#mazeSays")).toHaveText(SENTENCE);
    await expect(phone.locator("#mazeLetters text.route")).toHaveCount(maze.path.length);
    await expect(phone.locator("#nextBtn")).toBeEnabled();
  });
});

test("the maze is drawn with walls, and the route is the only way through", async ({ app, page, browser }) => {
  const { html, maze } = await mazeGame(app, page, "Teri Buana of the three worlds");

  await atTheMaze(browser, html, async (phone) => {
    /* Every wall the maze has is drawn: each square's top and left, plus the bottom and right
       edges of the grid. (A wall line has no thickness of its own, so it's counted, not looked at.) */
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

    /* A way in at the top and a way out at the bottom: the route runs between them, and those
       are the only two gaps in the outer wall. */
    const start = maze.path[0], end = maze.path.at(-1);
    expect(start, "the route starts on the top row").toBeLessThan(maze.cols);
    expect(end, "and ends on the bottom row").toBeGreaterThanOrEqual(maze.cols * (maze.rows - 1));
    expect(maze.walls[start] & N, "the way in is open").toBe(0);
    expect(maze.walls[end] & S, "the way out is open").toBe(0);
    const topGaps = [...Array(maze.cols).keys()].filter(c => !(maze.walls[c] & N));
    const bottomGaps = [...Array(maze.cols).keys()].map(c => c + maze.cols * (maze.rows - 1)).filter(c => !(maze.walls[c] & S));
    expect(topGaps).toEqual([start]);
    expect(bottomGaps).toEqual([end]);
    // The gold marker sits on the way in.
    const marker = await phone.locator("#mazeStart").evaluate(el => ({ cx: +el.getAttribute("cx"), cy: +el.getAttribute("cy") }));
    expect(marker).toEqual({ cx: (start % maze.cols) * 10 + 5, cy: 5 });
    const viewBox = await phone.locator("#mazeGrid").getAttribute("viewBox");
    expect(viewBox).toBe(`-0.6 -0.6 ${maze.cols * 10 + 1.2} ${maze.rows * 10 + 1.2}`);

    // Starting anywhere but the way in gets nowhere.
    const notTheStart = [...Array(maze.cols * maze.rows).keys()].find(c => c !== maze.path[0]);
    await trace(phone, maze, [notTheStart]);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(0);

    // Nor does starting part way along the route.
    await trace(phone, maze, [maze.path[1], maze.path[2]]);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(0);
    await expect(phone.locator("#nextBtn")).toBeDisabled();

    /* A wrong turn is walkable, and its squares carry letters too — which is what stops a team
       feeling their way by watching for letters. */
    const wrongTurn = (() => {
      const onRoute = new Set(maze.path);
      for (const [i, cell] of maze.path.entries()) {
        for (const d of [-maze.cols, maze.cols, -1, 1]) {
          const to = cell + d;
          if (to < 0 || to >= maze.cols * maze.rows || onRoute.has(to)) continue;
          if (d === -1 && cell % maze.cols === 0) continue;
          if (d === 1 && to % maze.cols === 0) continue;
          const bit = d === -maze.cols ? N : d === maze.cols ? S : d === 1 ? E : W;
          if (!(maze.walls[cell] & bit)) return { at: i, cell, to };
        }
      }
      return null;
    })();
    expect(wrongTurn, "the maze has a wrong turn to take").not.toBeNull();
    await trace(phone, maze, [...maze.path.slice(0, wrongTurn.at + 1), wrongTurn.to]);
    await expect(phone.locator("#mazeLetters text")).toHaveCount(wrongTurn.at + 2);
    await expect(phone.locator("#mazeLetters text.route")).toHaveCount(0, "nothing says it was wrong");
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

  /* The same sentence always makes the same maze, so nobody has to wonder which one teams will
     get; Try another is the only way to a different one. */
  const drawn = () => page.locator("#tfMazePrev svg").innerHTML();
  await page.locator("#tfMazeSentence").fill("Sang Nila Utama reigned over it and was given the name of Seri Teri Buana.");
  await page.locator("#tfMazeMake").click();
  const first = await drawn();
  await page.locator("#tfMazeMake").click();
  expect(await drawn()).toBe(first);
  await page.locator("#tfMazeAnother").click();
  const second = await drawn();
  expect(second).not.toBe(first);
  await page.locator("#tfMazeMake").click();
  expect(await drawn(), "Make the maze always comes back to the same one").toBe(first);
  await page.locator("#tfMazeSentence").fill("");
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

test("Try another keeps moving on, even after saving and reopening the challenge", async ({ app, page }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  const drawn = () => page.locator("#tfMazePrev svg").innerHTML();
  const openChallenge = () => page.locator("#taskList li").first().locator(".tedit").click();

  await openChallenge();
  await page.locator("#tfMazeSentence").fill(SENTENCE);
  await page.locator("#tfMazeMake").click();
  const first = await drawn();
  await page.locator("#tfMazeAnother").click();
  const second = await drawn();
  expect(second).not.toBe(first);
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskForm")).toBeHidden();

  // Reopened, it's still the one that was saved, and Try another goes on to a third.
  await openChallenge();
  expect(await drawn()).toBe(second);
  await page.locator("#tfMazeAnother").click();
  const third = await drawn();
  expect(third).not.toBe(second);
  expect(third).not.toBe(first);
});

test("the maze can be made harder or easier, and the choice sticks", async ({ app, page }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  const openChallenge = () => page.locator("#taskList li").first().locator(".tedit").click();
  const squares = async () => {
    const text = await page.locator("#tfMazeInfo").textContent();
    const [, cols, rows] = text.match(/(\d+) × (\d+) squares/);
    return Number(cols) * Number(rows);
  };

  await openChallenge();
  await expect(page.locator("#tfMazeLevel")).toHaveValue("hard");       // hard unless told otherwise
  await page.locator("#tfMazeSentence").fill(SENTENCE);
  await page.locator("#tfMazeMake").click();
  const hard = await squares();
  await expect(page.locator("#tfMazeInfo")).toContainText("false corridors");

  // Easier means a smaller grid: less of it is wrong turns.
  await page.locator("#tfMazeLevel").selectOption("easy");
  const easy = await squares();
  expect(easy).toBeLessThan(hard);
  await page.locator("#tfMazeLevel").selectOption("hard");
  expect(await squares()).toBe(hard);

  // The choice is kept with the challenge.
  await page.locator("#tfMazeLevel").selectOption("fair");
  const fair = await squares();
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskForm")).toBeHidden();
  await openChallenge();
  await expect(page.locator("#tfMazeLevel")).toHaveValue("fair");
  expect(await squares()).toBe(fair);
});

test("a maze saved before every square had a letter is mended, not thrown away", async ({ app, page, browser }) => {
  // Build one, then take the letters out of the saved draft: an older maze, as it would have been kept.
  const { maze } = await mazeGame(app, page);
  const before = await page.evaluate(id => {
    const key = "chinatown-hunt-m1:draft", draft = JSON.parse(localStorage.getItem(key));
    const task = draft.game.locations.find(l => l.id === id).tasks[0];
    delete task.maze.grid;
    localStorage.setItem(key, JSON.stringify(draft));
    return task.maze;
  }, THK.id);
  expect(before.grid).toBeUndefined();

  await page.reload();
  await app.openTools();
  await expect(page.locator("#exportInfo")).not.toContainText("letter");
  await expect(page.locator("#exportGame")).toBeEnabled();

  // The mended maze is the same maze: same walls, same route, same sentence — with letters added.
  const after = await page.evaluate(id => {
    const draft = JSON.parse(localStorage.getItem("chinatown-hunt-m1:draft"));
    return draft.game.locations.find(l => l.id === id).tasks[0].maze;
  }, THK.id);
  expect(after.grid.length).toBe(after.cols * after.rows);
  expect({ ...after, grid: undefined }).toEqual({ ...before, grid: undefined });
  expect([...after.path].map(c => after.grid[c]).join("")).toBe(after.letters);

  // And it plays: the letters are there on a phone.
  const html = await exportGame(page);
  await atTheMaze(browser, html, async (phone) => {
    await trace(phone, after, after.path.slice(0, 4));
    await expect(phone.locator("#mazeLetters text")).toHaveCount(4);
  });
});
