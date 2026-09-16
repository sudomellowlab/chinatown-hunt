// Browser tests: node build.js runs first, then the built dist file is tested with real geolocation.
//   npx playwright test
import { defineConfig, devices } from "@playwright/test";

// Participants play on phones; admins set locations and replay walks on a computer.
const ADMIN = /(locations|export|editor|mystery)\.spec\.mjs$/;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.mjs",
  globalSetup: "./e2e/global-setup.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    // The game, the walk recorder and field testing: a phone.
    { name: "phone", use: { ...devices["Pixel 7"] }, testIgnore: ADMIN },
    // Admin work: a laptop-sized desktop browser. Replay and export run here too.
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: [ADMIN, /(recorder|images|googlemap)\.spec\.mjs$/] },
  ],
});
