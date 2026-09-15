// CLI replay analysis and sweep. Run with: node --test
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { analyse, sweep, parseRange, withRadius, main } from "../scripts/replay.js";

const R = 6371000, M_PER_DEG = R * Math.PI / 180;
const A = { id: "a", name: "Alpha", lat: 1.28, lng: 103.847, radius: 25 };
const B = { id: "b", name: "Bravo", lat: 1.28 + 500 / M_PER_DEG, lng: 103.847, radius: 25 };   // 500 m north
const cfg = { radius: 25, accuracyCeiling: 50, consecutiveFixes: 3 };
const T0 = Date.UTC(2026, 8, 16, 1, 0, 0);                  // 09:00:00 in Singapore

// A walk: one fix per second, each at `metres` north of A with the given accuracy.
const walkOf = steps => steps.map(([m, accuracy = 8], i) => ({ t: T0 + i * 1000, lat: A.lat + m / M_PER_DEG, lng: A.lng, accuracy, source: "real" }));

describe("analyse", () => {
  test("reports when a location opened and how far inside the boundary the walker was", () => {
    const a = analyse(walkOf([[100], [60], [20], [15], [12], [0]]), [A, B], cfg);
    const alpha = a.locations[0];
    assert.equal(alpha.opened, true);
    assert.equal(alpha.openedFix, 4);                 // 20, 15, 12: the third inside
    assert.equal(alpha.openedAt, T0 + 4000);
    assert.ok(Math.abs(alpha.insideBy - 13) < 1e-6, `insideBy ${alpha.insideBy}`);
    assert.equal(a.opened, 1);
    assert.equal(a.total, 2);
  });

  test("reports the closest approach for a location that never opened", () => {
    const a = analyse(walkOf([[100], [40], [31], [45]]), [A], cfg);
    const alpha = a.locations[0];
    assert.equal(alpha.opened, false);
    assert.ok(Math.abs(alpha.closestAccepted - 31) < 1e-6);
  });

  test("tracks the best streak, for a location entered but never held long enough", () => {
    const a = analyse(walkOf([[10], [10], [40], [10], [40]]), [A], cfg);
    assert.equal(a.locations[0].opened, false);
    assert.equal(a.locations[0].bestStreak, 2);
  });

  test("separates the closest accepted fix from the closest of any fix", () => {
    const a = analyse(walkOf([[40], [5, 90], [35]]), [A], cfg);
    assert.ok(Math.abs(a.locations[0].closestAccepted - 35) < 1e-6);
    assert.ok(Math.abs(a.locations[0].closestAny - 5) < 1e-6);
  });

  test("counts ceiling rejections overall and near each location, separately from malformed fixes", () => {
    const fixes = walkOf([[10], [10, 80], [10, 51], [200, 99], [10]]);
    fixes.push({ t: T0 + 9000, lat: null, lng: null, accuracy: 5, source: "real" });
    const a = analyse(fixes, [A], cfg);
    assert.equal(a.rejectedCeiling, 3);
    assert.equal(a.rejectedOther, 1);
    assert.equal(a.locations[0].nearFixes, 4);        // the 200 m and malformed fixes aren't near
    assert.equal(a.locations[0].nearRejected, 2);
  });

  test("a rejected fix mid-streak doesn't reset it, exactly as in the app", () => {
    const a = analyse(walkOf([[5], [5], [5, 90], [5]]), [A], cfg);
    assert.equal(a.locations[0].openedFix, 3);
  });

  test("reports when the manual override would first have been available", () => {
    const steps = Array.from({ length: 100 }, () => [45]);   // 99 s at 45 m
    const a = analyse(walkOf(steps), [A], cfg);
    assert.equal(a.locations[0].overrideReadyAt, T0 + 91000);
  });

  test("respects the streak and ceiling settings", () => {
    const fixes = walkOf([[5, 40], [5, 40], [5, 40]]);
    assert.equal(analyse(fixes, [A], cfg).opened, 1);
    assert.equal(analyse(fixes, [A], { ...cfg, accuracyCeiling: 30 }).opened, 0);
    assert.equal(analyse(fixes, [A], { ...cfg, consecutiveFixes: 4 }).opened, 0);
  });

  test("withRadius forces one radius onto every location", () => {
    const fixes = walkOf([[20], [20], [20]]);
    assert.equal(analyse(fixes, withRadius([{ ...A, radius: 15 }], 22), cfg).opened, 1);
    assert.equal(analyse(fixes, [{ ...A, radius: 15 }], cfg).opened, 0);
  });
});

describe("sweep", () => {
  test("finds exactly the combinations that open every location", () => {
    // Passes 18 m from A with ±35 m fixes, and 28 m from B with ±15 m fixes.
    const toA = walkOf([[18, 35], [18, 35], [18, 35]]);
    const toB = [0, 1, 2].map(i => ({ t: T0 + 10_000 + i * 1000, lat: B.lat - 28 / M_PER_DEG, lng: B.lng, accuracy: 15, source: "real" }));
    const grid = sweep([...toA, ...toB], [A, B], cfg, [15, 20, 30], [20, 40]);
    const all = grid.flatMap(r => r.cells.filter(c => c.opened === c.total).map(c => `${r.radius}/${c.ceiling}`));
    assert.deepEqual(all, ["30/40"]);
    assert.deepEqual(grid.find(r => r.radius === 20).cells.map(c => c.opened), [0, 1]);
  });
});

describe("parseRange", () => {
  test("expands from:to:step inclusively", () => {
    assert.deepEqual(parseRange("10:30:5", "--radii"), [10, 15, 20, 25, 30]);
    assert.deepEqual(parseRange("0.5:1.5:0.5", "--x"), [0.5, 1, 1.5]);
  });
  test("rejects nonsense", () => {
    assert.throws(() => parseRange("10-30", "--radii"), /--radii/);
    assert.throws(() => parseRange("30:10:5", "--radii"), /to >= from/);
    assert.throws(() => parseRange("10:30:0", "--radii"), /step > 0/);
  });
});

describe("command line", () => {
  let dir, walkPath;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "replay-test-"));
    walkPath = join(dir, "walk.json");
    writeFileSync(walkPath, JSON.stringify({
      format: "chinatown-hunt-walk", version: 1, cfg, locations: [A, B],
      fixes: walkOf([[100], [20], [15], [10], [5, 80]]),
    }));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const run = (...args) => spawnSync(process.execPath, ["scripts/replay.js", ...args], { encoding: "utf8" });

  test("prints a per-location report", () => {
    const r = run(walkPath, "--radius", "25", "--ceiling", "50", "--streak", "3");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Opened 1 of 2/);
    assert.match(r.stdout, /Alpha .*OPENED 09:00:03 \(\+0:00:03\), 15\.0 m past the boundary/);
    assert.match(r.stdout, /Bravo .*not opened · closest accepted fix 400\.0 m/);
    assert.match(r.stdout, /Rejected: 1 of 5 fixes \(20%\) over the ceiling/);
  });

  test("says when a location was entered but the streak never completed", () => {
    const r = run(walkPath, "--streak", "5");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Alpha .*not opened · closest accepted fix 10\.0 m \(inside\) · best streak 3 of 5 · closest of any fix 5\.0 m/);
  });

  test("--sweep prints the grid and the winning combinations", () => {
    const r = run(walkPath, "--sweep", "--radii", "10:20:5", "--ceilings", "50:90:40");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /radius \\ ceiling/);
    assert.match(r.stdout, /No combination opens all 2 locations/);
  });

  test("--json is machine-readable", () => {
    const out = JSON.parse(execFileSync(process.execPath, ["scripts/replay.js", walkPath, "--json"], { encoding: "utf8" }));
    assert.equal(out.opened, 1);
    assert.equal(out.locations[1].opened, false);
  });

  test("--locations replaces the walk's saved locations", () => {
    const locPath = join(dir, "locs.json");
    writeFileSync(locPath, JSON.stringify([{ ...B, id: "b-only" }]));
    const out = JSON.parse(execFileSync(process.execPath, ["scripts/replay.js", walkPath, "--locations", locPath, "--json"], { encoding: "utf8" }));
    assert.deepEqual(out.locations.map(l => l.id), ["b-only"]);
  });

  test("usage errors exit non-zero with a message", () => {
    assert.equal(run().status, 2);
    const bad = run(walkPath, "--ceiling=-5");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--ceiling must be a positive number/);
    assert.equal(main(["--help"]).code, 0);
  });
});
