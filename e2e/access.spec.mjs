// Who sees the admin & dev tools. Participants open the plain link on a phone.
import { test, expect } from "./fixtures.mjs";

const devbtn = page => page.locator("#devbtn");
const banner = page => page.locator("#devbanner");

test("a participant's link shows no dev button, no banner and no tools", async ({ app, page }) => {
  await app.open({ query: "" });
  await expect(devbtn(page)).toBeHidden();
  await expect(banner(page)).toBeHidden();
  await expect(page.locator("#drawer")).not.toBeInViewport();

  await page.reload();
  await expect(devbtn(page)).toBeHidden();
});

test("?dev=1 turns the tools on, opens them once, and this device remembers", async ({ app, page }) => {
  await page.goto("https://hunt.test/chinatown-hunt.html?dev=1");
  await expect(page.locator("#drawer")).toHaveClass(/\bup\b/);          // first arrival: tools open
  await expect(banner(page)).toBeVisible();
  await app.closeTools();
  await expect(devbtn(page)).toBeVisible();

  // Reloading keeps admin mode without reopening the tools every time.
  await page.reload();
  await expect(page.locator(".pin")).toHaveCount(8);
  await expect(page.locator("#drawer")).not.toHaveClass(/\bup\b/);
  await expect(devbtn(page)).toBeVisible();

  // So does the plain link, on this device.
  await app.open({ query: "" });
  await expect(devbtn(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
});

test("?dev=0 turns the tools off again", async ({ app, page }) => {
  await app.open({ query: "?dev=1" });
  await expect(devbtn(page)).toBeVisible();

  await app.open({ query: "?dev=0" });
  await expect(devbtn(page)).toBeHidden();
  await expect(banner(page)).toBeHidden();

  await app.open({ query: "" });
  await expect(devbtn(page)).toBeHidden();
});
