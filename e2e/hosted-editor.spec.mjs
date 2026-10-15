// The admin file as the Game Editors site opens it (window.__CTH_HOSTED__ set first): the site edits the
// LoQuiz links through window.cthHosted, saves the draft and publishes the packs it builds.
import { test, expect } from "./fixtures.mjs";
import { Pack } from "../src/pack.js";
import { Vault } from "../src/vault.js";

const hostedFlag = html => html.replace("<head>", "<head><script>window.__CTH_HOSTED__ = true;</script>");
const link = taskId => [{ taskId, correctOnly: true }];

test("LoQuiz links and sync settings set through the editors site are saved and published", async ({ app, page }) => {
  await app.open({ patch: hostedFlag });
  await expect(page.locator("body")).toHaveClass(/hosted/);
  await page.evaluate(() => window.cthHosted.update(G => {
    const l = taskId => [{ taskId, correctOnly: true }];
    G.sync = { synchroMode: true };
    G.locations[0].loquizOpen = l("OPEN-1");
    G.locations[0].tasks[0].loquiz = l("Q-1");
    G.start = { name: "Briefing", lockText: "", arrivalText: "", password: "Red Lantern", loquizUnlock: l("UNLOCK"),
      tasks: [{ id: "t-start1", prompt: "Find the notebook.", loquiz: l("Q-S1") }] };
  }));

  // The draft in this browser carries them (the editors site saves it from here).
  const draft = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).game, await page.evaluate(() => window.cthHosted.draftKey));
  expect(draft.sync).toEqual({ synchroMode: true });
  expect(draft.locations[0].loquizOpen).toEqual(link("OPEN-1"));
  expect(draft.locations[0].tasks[0].loquiz).toEqual(link("Q-1"));
  expect(draft.start.loquizUnlock).toEqual(link("UNLOCK"));

  // What gets published: the unlock link outside the seal, the start's challenges (and their links) inside it.
  const packs = await page.evaluate(() => window.cthHosted.packs());
  expect(packs.fieldPack).toBeNull();
  const game = Pack.open(packs.gamePack);
  expect(game.sync).toEqual({ synchroMode: true });
  expect(game.locations[0].tasks[0].loquiz).toEqual(link("Q-1"));
  expect(game.start.loquizUnlock).toEqual(link("UNLOCK"));
  expect(game.start.tasks).toBeUndefined();
  const inside = JSON.parse(await Vault.open(game.start.sealed, "red lantern"));
  expect(inside.tasks[0].loquiz).toEqual(link("Q-S1"));
  expect(inside.loquizUnlock).toBeUndefined();
});

test("without the editors site there is no bridge", async ({ app, page }) => {
  await app.open();
  expect(await page.evaluate(() => typeof window.cthHosted)).toBe("undefined");
});
