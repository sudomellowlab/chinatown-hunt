// Always test a fresh build of the deliverable, never a stale dist/.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  execFileSync(process.execPath, ["build.js"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
  });
}
