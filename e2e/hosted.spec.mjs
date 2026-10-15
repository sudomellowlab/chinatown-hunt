// The hosted participant file (dist/chinatown-hunt-hosted.html): the file the Game Editors site hands out.
// Its content comes from the sync relay on every load, and it follows the team's LoQuiz answers.
// The relay is faked here: its content and current-event endpoints, and its WebSocket.
import { readFileSync } from "node:fs";
import { test, expect, far } from "./fixtures.mjs";
import { GAME } from "../src/game.js";
import { Pack } from "../src/pack.js";

const HOSTED_FILE = new URL("../dist/chinatown-hunt-hosted.html", import.meta.url);
const RELAY = "https://relay.test";
const EVENT = "LQGAME1";
const TEAM = { id: "team-a", name: "Red Lanterns", startTime: Math.floor(Date.now() / 1000) - 60, members: [] };
const link = taskId => [{ taskId, correctOnly: true }];

// The default game, with LoQuiz links on one location and its challenges.
function linkedGame({ synchroMode = true } = {}) {
  const game = structuredClone(GAME);
  const loc = game.locations.find(l => (l.tasks || []).length >= 3);   // so its second challenge has a Next
  loc.loquizOpen = link("Q-OPEN");
  loc.tasks.forEach((t, i) => { t.loquiz = link(`Q-${i}`); });
  game.sync = { synchroMode };
  return { game, loc };
}
// The hosted file as the editors site hands it out: relay address and a baked copy filled in.
const hostedHtml = (game, relay = RELAY) => readFileSync(HOSTED_FILE, "utf8")
  .replace('"__HOSTED_RELAY__"', () => JSON.stringify(relay))
  .replace('"__HOSTED_GAME_PACK__"', () => JSON.stringify(Pack.seal(game)))
  .replace('"__HOSTED_FIELD_PACK__"', "null");

// A fake relay: serves `published` (or nothing), says EVENT is current, and lets the test send answers.
async function fakeRelay(page, { published = null } = {}) {
  const relay = { sockets: [], answers: [], n: 0 };
  await page.context().route(`${RELAY}/api/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/content")
      return published ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 7, content: published }) })
        : route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"nothing_published"}' });
    if (url.pathname === "/api/current-event") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameId: EVENT, haveLive: false }) });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/relay\.test\/ws/, ws => {
    const url = new URL(ws.url());
    const team = url.searchParams.get("team");
    relay.sockets.push({ ws, team, game: url.searchParams.get("game") });
    ws.onMessage(m => { if (m === "ping") ws.send("pong"); });
    ws.send(JSON.stringify({ type: "init", data: { teams: [TEAM], answers: relay.answers.filter(a => !team || a.team.id === team) } }));
  });
  relay.answer = (taskId, correct = true) => {
    const ev = { key: `${TEAM.id}:${taskId}:${++relay.n}`, team: TEAM, answer: { taskId, correct, answer: "x", time: Math.floor(Date.now() / 1000) } };
    relay.answers.push(ev);
    for (const s of relay.sockets) if (s.team === TEAM.id) s.ws.send(JSON.stringify({ type: "answer", data: ev }));
  };
  return relay;
}

async function pickTeam(page) {
  await expect(page.locator("#teamPick")).toBeVisible();
  await page.locator("#teamPick .team", { hasText: TEAM.name }).click();
  await expect(page.locator("#teamPick")).toBeHidden();
  await expect(page.locator("#syncText")).toHaveText(`Synced · ${TEAM.name}`);
}

test("follows LoQuiz: an answer opens a location, moves through its challenges and finishes it", async ({ app, page }) => {
  const { game, loc } = linkedGame();
  const relay = await fakeRelay(page);
  await app.open({ html: hostedHtml(game) });
  await pickTeam(page);
  await app.begin(far(game.locations));
  expect(relay.sockets.some(s => s.game === EVENT && s.team === TEAM.id)).toBe(true);

  relay.answer("Q-OPEN");
  await expect(page.locator("#sheet")).toHaveClass(/up/);
  await expect(page.locator("#sheetname")).toHaveText(loc.name);

  relay.answer("Q-0");
  await expect(page.locator("#prompt")).toHaveText(loc.tasks[1].prompt);
  // Synchro Mode: the linked challenge waits for LoQuiz, with no Next.
  await expect(page.locator("#syncWait")).toBeVisible();
  await expect(page.locator("#nextBtn, #finishBtn")).toHaveCount(0);
  await expect(page.locator("#backBtn")).toBeVisible();

  relay.answer(`Q-${loc.tasks.length - 1}`, false);              // a wrong answer moves nothing
  await page.waitForTimeout(300);
  await expect(page.locator("#prompt")).toHaveText(loc.tasks[1].prompt);

  relay.answer(`Q-${loc.tasks.length - 1}`);
  await expect(page.locator("#sheet")).not.toHaveClass(/up/);
  await expect(page.locator("#reached")).toHaveText("1");
  await expect(page.locator(".pin")).toHaveCount(game.locations.length - 1);   // a finished location leaves the map
});

test("a phone joining late catches up with the answers its team already gave", async ({ app, page }) => {
  const { game, loc } = linkedGame();
  const relay = await fakeRelay(page);
  relay.answer("Q-OPEN");
  relay.answer("Q-0");
  await app.open({ html: hostedHtml(game) });
  await pickTeam(page);
  await app.begin(far(game.locations));
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
  await expect(page.locator("#prompt")).toHaveText(loc.tasks[1].prompt);
});

test("without Synchro Mode a linked challenge keeps its Next button", async ({ app, page }) => {
  const { game, loc } = linkedGame({ synchroMode: false });
  const relay = await fakeRelay(page);
  await app.open({ html: hostedHtml(game) });
  await pickTeam(page);
  await app.begin(far(game.locations));
  relay.answer("Q-OPEN");
  relay.answer("Q-0");
  await expect(page.locator("#prompt")).toHaveText(loc.tasks[1].prompt);
  await expect(page.locator("#nextBtn")).toBeVisible();
  await expect(page.locator("#syncWait")).toHaveCount(0);
});

test("playing without syncing: no LoQuiz, buttons as usual", async ({ app, page }) => {
  const { game } = linkedGame();
  await fakeRelay(page);
  await app.open({ html: hostedHtml(game) });
  app.expectDialog("Play without syncing? You'll move through each location on this phone yourselves.", { accept: true });
  await page.locator("#teamSkip").click();
  await expect(page.locator("#teamPick")).toBeHidden();
  await expect(page.locator("#syncText")).toHaveText("LoQuiz sync off");
});

test("plays what was published last, not the copy built into the file", async ({ app, page }) => {
  const { game } = linkedGame();
  const published = structuredClone(game);
  published.title = "Published on the editors site";
  await fakeRelay(page, { published: { gamePack: Pack.seal(published), fieldPack: null } });
  await app.open({ html: hostedHtml(game) });
  await expect(page.locator("#startTitle")).toHaveText("Published on the editors site");
});

test("with the relay out of reach it plays the copy built into the file, without sync", async ({ app, page }) => {
  const { game } = linkedGame();
  await page.context().route(`${RELAY}/**`, route => route.abort());
  await app.open({ html: hostedHtml(game) });
  await expect(page.locator("#startTitle")).toHaveText(game.title);
  await expect(page.locator("#teamPick")).toBeHidden();
  await expect(page.locator("#syncLine")).toHaveCount(0);
});
