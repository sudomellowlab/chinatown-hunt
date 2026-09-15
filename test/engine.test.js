// Engine unit tests. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";

const R = 6371000;                          // the engine's Earth radius
const M_PER_DEG = R * Math.PI / 180;        // metres per degree of latitude, exactly, on that sphere

const HOME = { lat: 1.28035, lng: 103.84705 };   // Telok Ayer Green (placeholder)
const north = (m, from = HOME) => ({ lat: from.lat + m / M_PER_DEG, lng: from.lng });

const cfg = { radius: 25, accuracyCeiling: 50, consecutiveFixes: 3 };
const loc = (id, at = HOME, extra = {}) => ({ id, name: id, lat: at.lat, lng: at.lng, ...extra });

// Feed a sequence of fixes through ingest(), threading state the way onFix does.
function walk(fixes, locations, c = cfg, start = {}) {
  let prev = { streaks: {}, opened: [], nearSince: {}, ...start };
  const outs = [];
  fixes.forEach((f, i) => {
    const out = Engine.ingest({ accuracy: 10, t: i * 1000, ...f }, locations, c, prev);
    prev = { streaks: out.streaks, opened: out.opened, nearSince: out.nearSince };
    outs.push(out);
  });
  return { outs, last: outs.at(-1), state: prev };
}
const at = (m, extra = {}) => ({ ...north(m), ...extra });

describe("haversine", () => {
  const close = (actual, expected, tol, msg) =>
    assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ±${tol}`);

  test("zero for identical points", () => {
    assert.equal(Engine.haversine(HOME.lat, HOME.lng, HOME.lat, HOME.lng), 0);
  });

  test("one degree of latitude along a meridian", () => {
    close(Engine.haversine(0, 0, 1, 0), M_PER_DEG, 1e-6, "1° lat");
  });

  test("one degree of longitude along the equator", () => {
    close(Engine.haversine(0, 103, 0, 104), M_PER_DEG, 1e-6, "1° lng at equator");
  });

  test("quarter meridian and antipodes", () => {
    close(Engine.haversine(0, 0, 90, 0), Math.PI * R / 2, 1e-6, "equator to pole");
    close(Engine.haversine(0, 0, 0, 180), Math.PI * R, 1e-6, "antipodal");
  });

  test("one degree of longitude shrinks with cos(latitude)", () => {
    // Along a parallel the great circle is slightly shorter than the arc; at 1.28° it's negligible.
    close(Engine.haversine(1.28, 103, 1.28, 104), M_PER_DEG * Math.cos(1.28 * Math.PI / 180), 0.5, "1° lng at 1.28°N");
  });

  test("~20m in Telok Ayer is accurate to well under a millimetre", () => {
    const n = north(20);
    close(Engine.haversine(HOME.lat, HOME.lng, n.lat, n.lng), 20, 1e-6, "20m north");

    const eastDeg = 20 / (M_PER_DEG * Math.cos(HOME.lat * Math.PI / 180));
    close(Engine.haversine(HOME.lat, HOME.lng, HOME.lat, HOME.lng + eastDeg), 20, 1e-3, "20m east");
  });

  test("symmetric", () => {
    const n = north(23.7);
    assert.equal(Engine.haversine(HOME.lat, HOME.lng, n.lat, n.lng), Engine.haversine(n.lat, n.lng, HOME.lat, HOME.lng));
  });
});

describe("screen", () => {
  const fix = (extra) => ({ ...HOME, accuracy: 10, ...extra });

  test("accepts accuracy below and exactly at the ceiling", () => {
    assert.equal(Engine.screen(fix({ accuracy: 3 }), cfg).ok, true);
    assert.equal(Engine.screen(fix({ accuracy: 49.99 }), cfg).ok, true);
    assert.equal(Engine.screen(fix({ accuracy: 50 }), cfg).ok, true);
  });

  test("rejects accuracy just above the ceiling, and says why", () => {
    const s = Engine.screen(fix({ accuracy: 50.01 }), cfg);
    assert.equal(s.ok, false);
    assert.match(s.why, /ceiling/);
    assert.equal(Engine.screen(fix({ accuracy: 999 }), cfg).ok, false);
  });

  test("follows the configured ceiling", () => {
    assert.equal(Engine.screen(fix({ accuracy: 30 }), { ...cfg, accuracyCeiling: 25 }).ok, false);
    assert.equal(Engine.screen(fix({ accuracy: 30 }), { ...cfg, accuracyCeiling: 35 }).ok, true);
  });

  test("rejects malformed coordinates", () => {
    const bad = [
      { lat: NaN }, { lng: NaN }, { lat: undefined }, { lng: undefined },
      { lat: Infinity }, { lng: -Infinity }, { lat: null }, { lng: null },
      { lat: "1.28035" }, { lat: "" }, { lat: 91 }, { lat: -90.5 }, { lng: 180.5 },
    ];
    for (const b of bad) {
      const s = Engine.screen(fix(b), cfg);
      assert.equal(s.ok, false, `should reject ${JSON.stringify(b)} (${String(Object.values(b)[0])})`);
      assert.equal(s.why, "malformed");
    }
  });

  test("rejects a fix with no usable accuracy", () => {
    for (const accuracy of [undefined, null, NaN, "10"]) {
      assert.equal(Engine.screen(fix({ accuracy }), cfg).ok, false, `accuracy ${String(accuracy)}`);
    }
  });
});

describe("ingest — streaks", () => {
  const locs = [loc("a")];

  test("increments on each qualifying fix inside the radius", () => {
    const { outs } = walk([at(5), at(5)], locs);
    assert.equal(outs[0].streaks.a, 1);
    assert.equal(outs[1].streaks.a, 2);
  });

  test("resets to zero on an accepted fix outside the radius", () => {
    const { outs } = walk([at(5), at(5), at(40)], locs);
    assert.equal(outs[2].streaks.a, 0);
    assert.deepEqual(outs[2].opened, []);
  });

  test("the radius boundary itself counts as inside", () => {
    const { last } = walk([at(24.999)], locs);
    assert.equal(last.streaks.a, 1);
    assert.equal(walk([at(25.001)], locs).last.streaks.a, 0);
  });

  test("fires on exactly the consecutiveFixes-th fix, and only once", () => {
    const { outs } = walk([at(5), at(5), at(5), at(5)], locs);
    assert.deepEqual(outs.map(o => o.fired), [[], [], ["a"], []]);
    assert.deepEqual(outs[1].opened, []);
    assert.deepEqual(outs[2].opened, ["a"]);
  });

  test("honours a different consecutiveFixes", () => {
    const c = { ...cfg, consecutiveFixes: 5 };
    const { outs } = walk([at(5), at(5), at(5), at(5), at(5)], locs, c);
    assert.equal(outs.findIndex(o => o.fired.length), 4);
    assert.deepEqual(walk([at(5)], locs, { ...cfg, consecutiveFixes: 1 }).last.fired, ["a"]);
  });

  test("a reset means starting the count again", () => {
    const { outs } = walk([at(5), at(5), at(40), at(5), at(5), at(5)], locs);
    assert.equal(outs.findIndex(o => o.fired.length), 5);
  });

  test("tracks several locations independently and can open two at once", () => {
    const other = loc("b", north(30));
    const { outs } = walk([at(15), at(15), at(15)], [loc("a"), other]);
    assert.deepEqual([...outs[2].fired].sort(), ["a", "b"]);
    const { last } = walk([at(0), at(0)], [loc("a"), other]);
    assert.deepEqual(last.streaks, { a: 2, b: 0 });
  });

  test("does not mutate the state it was given", () => {
    const prev = { streaks: { a: 2 }, opened: [], nearSince: { a: 0 } };
    const snapshot = structuredClone(prev);
    Engine.ingest({ ...north(5), accuracy: 10, t: 1000 }, locs, cfg, prev);
    assert.deepEqual(prev, snapshot);
  });
});

describe("ingest — rejected fixes leave progress untouched", () => {
  // Deliberate: a rejected fix carries no information about position, so it must
  // not reset a streak. If someone "fixes" ingest() to treat a rejected fix as
  // leaving the radius, these fail.
  const locs = [loc("a")];

  test("a fix over the ceiling, far outside the radius, does not reset the streak", () => {
    const { outs } = walk([at(5), at(5), at(300, { accuracy: 80 })], locs);
    assert.equal(outs[2].screen.ok, false);
    assert.equal(outs[2].streaks.a, 2);
  });

  test("progress resumes where it left off: the next good fix opens", () => {
    const { outs } = walk([at(5), at(5), at(300, { accuracy: 80 }), at(300, { accuracy: 200 }), at(5)], locs);
    assert.deepEqual(outs.map(o => o.fired), [[], [], [], [], ["a"]]);
  });

  test("a rejected fix inside the radius does not count toward the streak either", () => {
    const { outs } = walk([at(5), at(5, { accuracy: 80 }), at(5)], locs);
    assert.equal(outs[1].streaks.a, 1);
    assert.equal(outs[2].streaks.a, 2);
    assert.deepEqual(outs[2].fired, []);
  });

  test("a malformed fix does not reset the streak", () => {
    const { outs } = walk([at(5), at(5), { lat: null, lng: null }, at(5)], locs);
    assert.equal(outs[2].streaks.a, 2);
    assert.deepEqual(outs[3].fired, ["a"]);
  });
});

describe("ingest — opened locations never re-lock", () => {
  const locs = [loc("a")];

  test("stays open after walking far away", () => {
    const { outs } = walk([at(5), at(5), at(5), at(500), at(5000), at(40)], locs);
    for (const o of outs.slice(2)) assert.deepEqual(o.opened, ["a"]);
  });

  test("stays open through rejected and malformed fixes", () => {
    const { last } = walk([at(5), at(5), at(5), at(900, { accuracy: 500 }), { lat: NaN, lng: NaN }], locs);
    assert.deepEqual(last.opened, ["a"]);
  });

  test("never fires again on returning inside", () => {
    const { outs } = walk([at(5), at(5), at(5), at(500), at(5), at(5), at(5), at(5)], locs);
    assert.equal(outs.flatMap(o => o.fired).length, 1);
  });

  test("an already-opened location passed in stays open and does not fire", () => {
    const { outs } = walk([at(5), at(5), at(5), at(500)], locs, cfg, { opened: ["a"] });
    assert.ok(outs.every(o => o.fired.length === 0 && o.opened.includes("a")));
  });
});

describe("per-location radius", () => {
  test("a smaller per-location radius overrides the default", () => {
    const locs = [loc("tight", HOME, { radius: 10 }), loc("default", HOME)];
    const { last } = walk([at(15), at(15), at(15)], locs);
    assert.deepEqual(last.opened, ["default"]);
    assert.equal(last.streaks.tight, 0);
  });

  test("a larger per-location radius overrides the default", () => {
    const locs = [loc("wide", HOME, { radius: 40 }), loc("default", HOME)];
    const { last } = walk([at(35), at(35), at(35)], locs);
    assert.deepEqual(last.opened, ["wide"]);
  });

  test("radiusOf falls back to the default only when radius is absent", () => {
    assert.equal(Engine.radiusOf({}, cfg), 25);
    assert.equal(Engine.radiusOf({ radius: 18 }, cfg), 18);
    assert.equal(Engine.radiusOf({ radius: null }, cfg), 25);
  });

  test("ranges reports each location's effective radius, nearest first", () => {
    const locs = [loc("far", north(100), { radius: 30 }), loc("near", HOME)];
    const r = Engine.ranges({ ...HOME, accuracy: 10 }, locs, cfg);
    assert.deepEqual(r.map(g => [g.id, g.r]), [["near", 25], ["far", 30]]);
  });
});

describe("manual override timer", () => {
  // Default: more than 90 000 ms within 60 m of an unopened location.
  const locs = [loc("a")];
  const fixAt = (m, t, extra = {}) => ({ ...north(m), accuracy: 10, t, ...extra });
  const run = (fixes, c = cfg) => {
    let prev = { streaks: {}, opened: [], nearSince: {} };
    return fixes.map(f => {
      const out = Engine.ingest(f, locs, c, prev);
      prev = { streaks: out.streaks, opened: out.opened, nearSince: out.nearSince };
      return out;
    });
  };

  test("becomes ready strictly after 90s within 60m, measured by fix.t", () => {
    const outs = run([fixAt(40, 0), fixAt(40, 90000), fixAt(40, 90001)]);
    assert.deepEqual(outs.map(o => o.overrideReady), [[], [], ["a"]]);
    assert.deepEqual(outs[2].nearSince, { a: 0 });
  });

  test("uses fix timestamps, not the wall clock: one fix per minute still works", () => {
    const outs = run([fixAt(40, 1e12), fixAt(40, 1e12 + 60000), fixAt(40, 1e12 + 120000)]);
    assert.deepEqual(outs[2].overrideReady, ["a"]);
  });

  test("60m is inside, just beyond is not", () => {
    assert.deepEqual(run([fixAt(59.99, 0), fixAt(59.99, 100000)])[1].overrideReady, ["a"]);
    assert.deepEqual(run([fixAt(60.01, 0), fixAt(60.01, 100000)])[1].overrideReady, []);
  });

  test("leaving range clears the timer; returning starts it again", () => {
    const outs = run([fixAt(40, 0), fixAt(80, 50000), fixAt(40, 60000), fixAt(40, 140000), fixAt(40, 150001)]);
    assert.deepEqual(outs[1].nearSince, {});
    assert.deepEqual(outs[2].nearSince, { a: 60000 });
    assert.deepEqual(outs[3].overrideReady, []);
    assert.deepEqual(outs[4].overrideReady, ["a"]);
  });

  test("opening the location clears its timer", () => {
    const outs = run([fixAt(40, 0), fixAt(5, 95000), fixAt(5, 96000), fixAt(5, 97000), fixAt(5, 200000)]);
    assert.deepEqual(outs[1].overrideReady, ["a"]);
    assert.deepEqual(outs[3].fired, ["a"]);
    assert.deepEqual(outs[3].nearSince, {});
    assert.deepEqual(outs[4].overrideReady, []);
  });

  test("a location opened outside the engine (manual override) drops its timer on the next fix", () => {
    const prev = { streaks: {}, opened: ["a"], nearSince: { a: 0 } };
    for (const f of [fixAt(40, 100000), fixAt(40, 100000, { accuracy: 80 })]) {
      const out = Engine.ingest(f, locs, cfg, prev);
      assert.deepEqual(out.nearSince, {});
      assert.deepEqual(out.overrideReady, []);
    }
  });

  test("a rejected fix neither starts a timer nor clears one", () => {
    // Far away and over the ceiling: would clear the timer if it were believed.
    const outs = run([fixAt(40, 0), fixAt(900, 30000, { accuracy: 80 }), fixAt(40, 91000)]);
    assert.deepEqual(outs[1].nearSince, { a: 0 });
    assert.deepEqual(outs[2].overrideReady, ["a"]);

    // Close by but over the ceiling: must not start one.
    const outs2 = run([fixAt(40, 0, { accuracy: 80 }), fixAt(40, 100000, { accuracy: 80 })]);
    assert.deepEqual(outs2[1].nearSince, {});
    assert.deepEqual(outs2[1].overrideReady, []);
  });

  test("a rejected fix's timestamp still advances a running timer, so the button isn't hidden", () => {
    const outs = run([fixAt(40, 0), fixAt(900, 91000, { accuracy: 80 })]);
    assert.deepEqual(outs[1].overrideReady, ["a"]);
  });

  test("a malformed fix leaves the timer running", () => {
    const outs = run([fixAt(40, 0), { lat: NaN, lng: NaN, accuracy: 10, t: 50000 }, fixAt(40, 91000)]);
    assert.deepEqual(outs[1].nearSince, { a: 0 });
    assert.deepEqual(outs[2].overrideReady, ["a"]);
  });

  test("a fix without a usable timestamp leaves the timers as they were", () => {
    const outs = run([fixAt(40, 0), fixAt(900, undefined), fixAt(900, NaN), fixAt(40, 91000)]);
    assert.deepEqual(outs[1].nearSince, { a: 0 });
    assert.deepEqual(outs[2].nearSince, { a: 0 });
    assert.deepEqual(outs[3].overrideReady, ["a"]);
  });

  test("overrideRange and overrideDwellMs are configurable", () => {
    const c = { ...cfg, overrideRange: 30, overrideDwellMs: 10000 };
    assert.deepEqual(run([fixAt(40, 0), fixAt(40, 20000)], c)[1].overrideReady, []);
    assert.deepEqual(run([fixAt(20, 0), fixAt(20, 10001)], c)[1].overrideReady, ["a"]);
  });
});
