// A document on a challenge: a handout teams read inside the game, one picture per page,
// instead of a PDF opening in another tab. Set up in the admin panel, read on a phone.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, createApp, offset, pickArrival, far, IMG } from "./fixtures.mjs";
import { GAME } from "../src/game.js";

const THK = GAME.locations.find(l => l.id === "thian-hock-keng");
const route = pickArrival([THK, ...GAME.locations.filter(l => l !== THK)]);
const PAGES = Array.from({ length: 12 }, (_, i) => `${IMG}/notebook/page-${i + 1}.png`);

async function exportGame(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exportGame").click()]);
  return readFileSync(await dl.path(), "utf8");
}
// Play the exported file on a phone, standing at the temple.
async function atTheTemple(browser, html, fn) {
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await phone.newPage();
    const { app, done } = await createApp({ page, context: phone });
    await app.open({ html });
    await app.begin(far(GAME.locations));
    for (const p of route.approach) await app.fix(p);
    for (let i = 0; i < 3; i++) await app.fix(offset(THK, 1, i * 120));
    await expect(page.locator("#sheetname")).toHaveText(THK.name);
    await fn(page, app);
    done();
  } finally {
    await phone.close();
  }
}

test("a 12-page handout opens over the challenge, turns page by page, and closes back to it", async ({ app, page, browser }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await page.locator("#taskList li").first().locator(".tedit").click();
  await page.locator("#tfDocLabel").fill("Open the notebook");
  await page.locator("#tfDocPages").fill(PAGES.join("\n"));
  await expect(page.locator("#tfDocInfo")).toContainText("12 pages");
  await expect(page.locator("#tfDocInfo")).toContainText('Teams tap "Open the notebook"');
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskList li").first().locator(".tpts")).toContainText("document, 12 pages");

  const html = await exportGame(page);
  await atTheTemple(browser, html, async (phone) => {
    await phone.locator("#nextBtn").click();                       // the first challenge
    const viewer = phone.locator("#doc");
    await expect(viewer).toBeHidden();

    await phone.locator("#docBtn").click();
    await expect(phone.locator("#docBtn")).toHaveText("Open the notebook");
    await expect(viewer).toBeVisible();
    await expect(phone.locator("#docTitle")).toHaveText("notebook");
    await expect(phone.locator("#docPage img")).toHaveAttribute("src", PAGES[0]);
    await expect(phone.locator("#docJump")).toHaveValue("0");
    await expect(phone.locator("#docPrev")).toBeDisabled();
    await expect(phone.locator("#docNext")).toBeEnabled();

    // Page by page, then straight to a page near the end, then the end.
    await phone.locator("#docNext").click();
    await expect(phone.locator("#docPage img")).toHaveAttribute("src", PAGES[1]);
    await phone.locator("#docPrev").click();
    await expect(phone.locator("#docPage img")).toHaveAttribute("src", PAGES[0]);
    await phone.locator("#docJump").selectOption("10");
    await expect(phone.locator("#docPage img")).toHaveAttribute("src", PAGES[10]);
    await phone.locator("#docNext").click();
    await expect(phone.locator("#docPage img")).toHaveAttribute("src", PAGES[11]);
    await expect(phone.locator("#docNext")).toBeDisabled();

    // Tapping the page zooms in and out for the small print.
    await phone.locator("#docPage img").click();
    await expect(phone.locator("#docPage")).toHaveClass(/\bzoom\b/);
    await phone.locator("#docPage img").click();
    await expect(phone.locator("#docPage")).not.toHaveClass(/\bzoom\b/);

    // Close comes back to the same challenge, with the game where it was.
    await phone.locator("#docClose").click();
    await expect(viewer).toBeHidden();
    await expect(phone.locator("#prompt")).toHaveText(THK.tasks[0].prompt);
    await expect(phone.locator("#sheet")).toHaveClass(/\bup\b/);

    // Moving to the next challenge closes it and takes the button away.
    await phone.locator("#docBtn").click();
    await expect(viewer).toBeVisible();
    await phone.locator("#docClose").click();
    await phone.locator("#nextBtn").click();
    await expect(viewer).toBeHidden();
    await expect(phone.locator("#docBtn")).toHaveCount(0);
  });
});

test("the pages download at Begin, and a page that won't load says so inside the viewer", async ({ app, page, browser }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await page.locator("#taskList li").first().locator(".tedit").click();
  await page.locator("#tfDocPages").fill(PAGES.slice(0, 2).join("\n"));
  await page.locator("#tfSave").click();
  const html = await exportGame(page);

  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const phonePage = await phone.newPage();
    const { app: player, done } = await createApp({ page: phonePage, context: phone });
    player.images.failing.add("/notebook/page-2.png");
    await player.open({ html });
    await player.begin(far(GAME.locations));
    await expect.poll(() => player.images.requests.filter(p => p.startsWith("/notebook/")).length,
      { message: "both pages fetched at Begin" }).toBe(2);

    for (const p of route.approach) await player.fix(p);
    for (let i = 0; i < 3; i++) await player.fix(offset(THK, 1, i * 120));
    await phonePage.locator("#nextBtn").click();
    await phonePage.locator("#docBtn").click();
    await expect(phonePage.locator("#docBtn")).toHaveText("Open the document");     // no wording set
    await phonePage.locator("#docNext").click();
    await expect(phonePage.locator("#docPage .picfail")).toBeVisible();
    await expect(phonePage.locator("#docPage")).toContainText("Image didn't load");
    done();
  } finally {
    await phone.close();
  }
});

test("a page link that isn't an https picture is refused and blocks export", async ({ app, page }) => {
  await app.open();
  await app.openTools();
  await page.locator("#capTarget").selectOption(THK.id);
  await page.locator("#taskList li").first().locator(".tedit").click();
  await page.locator("#tfDocPages").fill(`${PAGES[0]}\nhttp://img.test/notebook/page-2.png`);
  await expect(page.locator("#tfDocInfo")).toContainText("page 2 of the document: the image link must start with https://");
  await page.locator("#tfSave").click();
  await expect(page.locator("#tfErrors")).toContainText("page 2 of the document");
  await expect(page.locator("#taskForm")).toBeVisible();

  await page.locator("#tfDocPages").fill(PAGES[0]);
  await page.locator("#tfSave").click();
  await expect(page.locator("#taskForm")).toBeHidden();
  await expect(page.locator("#exportGame")).toBeEnabled();
  await expect(page.locator("#taskList li").first().locator(".tpts")).toContainText("document, 1 page");
});

test("an open handout gives way when the team is moved elsewhere", async ({ app, page }) => {
  // In the admin file, where the challenge shortcuts and the clues preview are to hand.
  await app.open();
  const locs = await app.locations();
  await app.openTools();
  const loc = locs.find(l => l.id === "thian-hock-keng");
  await page.locator("#capTarget").selectOption(loc.id);
  await page.locator("#taskList li").first().locator(".tedit").click();
  await page.locator("#tfDocPages").fill(PAGES.slice(0, 3).join("\n"));
  await page.locator("#tfSave").click();
  await app.closeTools();

  await app.startGps(loc);
  for (let i = 0; i < 3; i++) await app.fix(loc);                  // walk in
  await expect(page.locator("#sheetname")).toHaveText(loc.name);
  await page.locator("#nextBtn").click();                          // onto the first challenge
  await page.locator("#docBtn").click();
  await expect(page.locator("#doc")).toBeVisible();

  /* The viewer covers the screen, so the admin button is out of reach while it's open (as it
     should be): press the shortcut without the mouse. Moving to the next challenge closes the
     viewer, even though nobody touched Close. */
  await page.locator("#solveOne").evaluate(el => el.click());
  await expect(page.locator("#doc")).toBeHidden();
  await expect(page.locator("#docBtn")).toHaveCount(0, "the second challenge has no document");

  // The clues screen takes over from an open viewer too.
  await page.locator("#backBtn").click();
  await page.locator("#docBtn").click();
  await expect(page.locator("#doc")).toBeVisible();
  await page.locator("#previewReveal").evaluate(el => el.click());
  await expect(page.locator("#reveal")).toBeVisible();
  await expect(page.locator("#doc")).toBeHidden();
});

test("in Preview, Close sits above the preview bar and the page fills the space between", async ({ app, page }) => {
  await app.open();
  const locs = await app.locations();                                // this closes the panel again
  const loc = locs.find(l => l.id === "thian-hock-keng");
  await app.openTools();
  await page.locator("#capTarget").selectOption(loc.id);
  await page.locator("#taskList li").first().locator(".tedit").click();
  await page.locator("#tfDocPages").fill(PAGES.slice(0, 4).join("\n"));
  await page.locator("#tfSave").click();

  const [pv] = await Promise.all([page.waitForEvent("popup"), page.locator("#previewGame").click()]);
  await pv.waitForLoadState("load");
  pv.on("dialog", d => d.accept());
  await pv.setViewportSize({ width: 390, height: 780 });
  await pv.locator("#startBtn").click();
  await pv.locator("#pvGo").selectOption(loc.id);
  await expect(pv.locator("#sheetname")).toHaveText(loc.name);
  await pv.locator("#nextBtn").click();
  await pv.locator("#docBtn").click();
  await expect(pv.locator("#doc")).toBeVisible();

  // The preview bar must not swallow Close: whatever is on top at its centre is the button itself.
  const onTop = await pv.locator("#docClose").evaluate(el => {
    const b = el.getBoundingClientRect();
    return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.id;
  });
  expect(onTop).toBe("docClose");
  await pv.locator("#docClose").click();
  await expect(pv.locator("#doc")).toBeHidden();
  await expect(pv.locator("#prompt")).toBeVisible();

  /* The page takes the full width at its own shape: none of the caps that stop a challenge's
     picture filling the screen (max-height: 46vh and friends) apply in here. */
  await pv.locator("#docBtn").click();
  const shown = await pv.locator("#docPage img").evaluate(el => {
    const b = el.getBoundingClientRect(), box = el.closest("#docPage").getBoundingClientRect();
    return { w: b.width, h: b.height, cap: getComputedStyle(el).maxHeight, ratio: el.naturalHeight / el.naturalWidth,
             above: b.y - box.y, below: box.bottom - b.bottom };
  });
  expect(shown.cap).toBe("none");
  expect(shown.w).toBe(390);
  expect(Math.round(shown.h)).toBe(Math.round(390 * shown.ratio));   // nothing is trimming it
  expect(Math.abs(shown.above - shown.below)).toBeLessThan(2);       // centred in the space it has
});
