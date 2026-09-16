// Linked images: on challenge questions (phone), on the clues screen (phone), and in the editor (computer).
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, offset, pickArrival, far, IMG } from "./fixtures.mjs";
import { GAME } from "../src/game.js";
import { Pack } from "../src/pack.js";

const PLAY_FILE = new URL("../dist/chinatown-hunt.html", import.meta.url);
const THK = GAME.locations.find(l => l.id === "thian-hock-keng");
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);
const MIN = 60_000;

// The default game with images added, sealed into a participant file.
function gameWithImages() {
  const game = structuredClone(GAME);
  const thk = game.locations.find(l => l.id === THK.id);
  thk.tasks[0].image = `${IMG}/hunt/lions.png`;
  thk.tasks[1].image = `${IMG}/hunt/doors.png`;
  game.clues[0].image = `${IMG}/hunt/ledger.png`;
  game.suspects[0].image = `${IMG}/hunt/tan.png`;
  game.suspects[2].image = `${IMG}/hunt/missing.png`;
  return game;
}
const playHtml = game => readFileSync(PLAY_FILE, "utf8").replace(/Pack\.open\("cth1\.[^"]+"\)/, () => `Pack.open(${JSON.stringify(Pack.seal(game))})`);
const loaded = locator => locator.evaluate(img => img.complete && img.naturalWidth > 0);

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "participant view");

  test("a challenge shows its picture above the question; one without a picture shows none", async ({ app, page }) => {
    const game = gameWithImages();
    await app.open({ file: "play", html: playHtml(game) });
    await app.begin(far(GAME.locations));
    for (const p of route.approach) await app.fix(p);
    for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
    await page.locator("#stageBtn").click();

    const img = page.locator("#stage figure.qimg img");
    await expect(img).toHaveAttribute("src", `${IMG}/hunt/lions.png`);
    await expect.poll(() => loaded(img)).toBe(true);
    await expect(img).toBeInViewport();
    // Picture first, then the question.
    const [picY, promptY] = await Promise.all([img.boundingBox(), page.locator("#prompt").boundingBox()]);
    expect(picY.y).toBeLessThan(promptY.y);

    await page.locator(".opt").nth(0).click(); await page.locator("#stageBtn").click();
    await expect(page.locator("#stage figure.qimg img")).toHaveAttribute("src", `${IMG}/hunt/doors.png`);
    await page.locator("#answerInput").fill("2"); await page.locator("#stageBtn").click();
    await expect(page.locator("#prompt")).toHaveText(THK.tasks[2].prompt);
    await expect(page.locator("#stage figure")).toHaveCount(0);
  });

  test("Begin downloads every picture in the game up front", async ({ app }) => {
    await app.open({ file: "play", html: playHtml(gameWithImages()) });
    expect(app.images.requests, "nothing is fetched before Begin").toEqual([]);
    await app.begin(far(GAME.locations));
    await expect.poll(() => [...new Set(app.images.requests)].sort()).toEqual(
      ["/hunt/doors.png", "/hunt/ledger.png", "/hunt/lions.png", "/hunt/missing.png", "/hunt/tan.png"]);
  });

  test("a picture that fails to load says so, and Try again fetches it", async ({ app, page }) => {
    app.images.failing.add("/hunt/lions.png");
    await app.open({ file: "play", html: playHtml(gameWithImages()) });
    await app.begin(far(GAME.locations));
    for (const p of route.approach) await app.fix(p);
    for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
    await page.locator("#stageBtn").click();

    const fail = page.locator("#stage .picfail");
    await expect(fail).toBeVisible();
    await expect(fail).toContainText("Image didn't load. Check your signal.");
    await expect(page.locator("#stage figure.qimg img")).toBeHidden();
    await expect(page.locator("#prompt"), "the question still shows").toHaveText(THK.tasks[0].prompt);

    app.images.failing.delete("/hunt/lions.png");                    // signal is back
    await fail.getByRole("button", { name: "Try again" }).click();
    await expect(fail).toBeHidden();
    await expect.poll(() => loaded(page.locator("#stage figure.qimg img"))).toBe(true);
  });

  test("the clues screen shows clue pictures and suspect portraits", async ({ app, page }) => {
    const game = gameWithImages();
    app.images.failing.add("/hunt/missing.png");
    await page.clock.install({ time: new Date("2026-09-20T09:00:00+08:00") });
    await app.open({ file: "play", html: playHtml(game) });
    await app.begin(far(GAME.locations));
    await page.clock.fastForward((game.durationMinutes - game.revealMinutes) * MIN + 1_000);
    await expect(page.locator("#reveal")).toBeVisible();

    const clueImg = page.locator("#clueList li").first().locator("img");
    await expect(clueImg).toHaveAttribute("src", `${IMG}/hunt/ledger.png`);
    await expect.poll(() => loaded(clueImg)).toBe(true);
    await expect(page.locator("#clueList li").nth(1).locator("figure")).toHaveCount(0);

    const tan = page.locator("#suspectList li").first();
    await expect(tan).toHaveClass(/\bwithpic\b/);
    await expect(tan.locator("img")).toHaveAttribute("alt", `Portrait of ${game.suspects[0].name}`);
    await expect.poll(() => loaded(tan.locator("img"))).toBe(true);
    await expect(page.locator("#suspectList li").nth(1).locator("figure")).toHaveCount(0);
    // A missing portrait says so without hiding the suspect.
    const lim = page.locator("#suspectList li").nth(2);
    await expect(lim.locator(".picfail")).toBeVisible();
    await expect(lim.locator("strong")).toHaveText(game.suspects[2].name);
  });
});

test.describe("in the admin panel", () => {
  test.skip(({ isMobile }) => isMobile, "admin view");
  let admin;
  test.beforeEach(async ({ app, page }) => {
    admin = app;
    await app.open();
    await app.openTools();
    await page.locator("#capTarget").selectOption(THK.id);
  });

  test("add a picture to a challenge, a clue and a suspect; a phone shows them from the exported file", async ({ page, browser }) => {
    // Challenge 1: preview appears as the link is typed.
    await page.locator("#taskList > li").first().locator(".tedit").click();
    await page.locator("#tfImage").fill(`${IMG}/hunt/lions.png`);
    await expect.poll(() => loaded(page.locator("#tfImagePrev img"))).toBe(true);
    await page.locator("#tfSave").click();
    await expect(page.locator("#taskList > li").first().locator(".tpts")).toHaveText("image · hint");

    // Clue 1 and suspect 1.
    await page.locator("#clueEdit > li").first().locator("input.imglink").fill(`${IMG}/hunt/ledger.png`);
    await expect.poll(() => loaded(page.locator("#clueEdit > li").first().locator(".imgprev img"))).toBe(true);
    await page.locator("#suspectEdit > li").first().locator("input.imglink").fill(`${IMG}/hunt/tan.png`);

    // Survives a reload, then check links and export.
    await page.reload();
    await expect(page.locator(".pin")).toHaveCount(8);
    await admin.openTools();
    await expect(page.locator("#clueEdit > li").first().locator("input.imglink")).toHaveValue(`${IMG}/hunt/ledger.png`);
    await page.locator("#checkImages").click();
    await expect(page.locator("#imageInfo")).toHaveText("All 3 image links load.");

    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
    const html = readFileSync(await dl.path(), "utf8");
    expect(html, "links are scrambled in the file").not.toContain("img.test");

    const phone = await browser.newContext({ ...devices["Pixel 7"] });
    try {
      const phonePage = await phone.newPage();
      const { app: player, done } = await createApp({ page: phonePage, context: phone });
      await player.open({ html });
      await player.begin(far(GAME.locations));
      await expect.poll(() => [...new Set(player.images.requests)].sort()).toEqual(["/hunt/ledger.png", "/hunt/lions.png", "/hunt/tan.png"]);
      for (const p of route.approach) await player.fix(p);
      for (let i = 0; i < 3; i++) await player.fix(offset(THK, 1, i * 120));
      await phonePage.locator("#stageBtn").click();
      await expect(phonePage.locator("#stage figure.qimg img")).toHaveAttribute("src", `${IMG}/hunt/lions.png`);
      done();
    } finally {
      await phone.close();
    }
  });

  test("an http or malformed link is refused with the reason; clearing the link removes the picture", async ({ page }) => {
    await page.locator("#taskList > li").first().locator(".tedit").click();
    await page.locator("#tfImage").fill("http://img.test/hunt/lions.png");
    await expect(page.locator("#tfImagePrev")).toHaveText("the image link must start with https:// (phones block http images)");
    await page.locator("#tfSave").click();
    await expect(page.locator("#tfErrors")).toHaveText("Can't save yet: the image link must start with https:// (phones block http images)");
    await page.locator("#tfImage").fill("");
    await page.locator("#tfSave").click();
    await expect(page.locator("#taskForm")).toBeHidden();

    await page.locator("#suspectEdit > li").first().locator("input.imglink").fill("tan.png");
    await expect(page.locator("#suspectEdit > li").first().locator(".imgprev")).toHaveText("the image link isn't a web address");
    await expect(page.locator("#exportGame")).toBeDisabled();
    await expect(page.locator("#exportInfo")).toContainText("Suspects: suspect 1: the image link isn't a web address");
    await page.locator("#suspectEdit > li").first().locator("input.imglink").fill("");
    await expect(page.locator("#exportGame")).toBeEnabled();
  });

  test("Check image links names each picture that doesn't load, and where it's used", async ({ app, page }) => {
    app.images.failing.add("/hunt/typo.png");
    await page.locator("#taskList > li").nth(1).locator(".tedit").click();
    await page.locator("#tfImage").fill(`${IMG}/hunt/typo.png`);
    await expect(page.locator("#tfImagePrev")).toHaveText("This link doesn't load an image. Check the address.");
    await page.locator("#tfSave").click();                        // a working-looking link can still be saved
    await page.locator("#clueEdit > li").nth(2).locator("input.imglink").fill(`${IMG}/hunt/ok.png`);

    await page.locator("#checkImages").click();
    await expect(page.locator("#imageInfo")).toHaveText(`1 image didn't load:\n• ${THK.name}, challenge 2: ${IMG}/hunt/typo.png`);
    await expect(page.locator("#imageInfo")).toHaveClass(/\bbad\b/);
  });
});

test("admin file: a location open during a reload shows the edited challenge, not the default", async ({ app, page, isMobile }) => {
  test.skip(isMobile, "admin view");
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await page.locator("#taskList > li").first().locator(".tedit").click();
  await page.locator("#tfPrompt").fill("An edited first question.");
  await page.locator("#tfImage").fill(`${IMG}/hunt/lions.png`);
  await page.locator("#tfSave").click();
  await page.locator("#jump").selectOption(THK.id);
  await page.locator("#stageBtn").click();
  await expect(page.locator("#prompt")).toHaveText("An edited first question.");

  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await expect(page.locator("#prompt")).toHaveText("An edited first question.");
  await expect(page.locator("#stage figure.qimg img")).toHaveAttribute("src", `${IMG}/hunt/lions.png`);
});
