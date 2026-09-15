// Browser tests: node build.js runs first, then the built dist file is tested with real geolocation.
//   npx playwright test
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.mjs",
  globalSetup: "./e2e/global-setup.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Pixel 7"],          // phone-sized viewport, touch, mobile UA
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
});
