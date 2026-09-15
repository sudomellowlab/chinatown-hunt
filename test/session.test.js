// Walk recording and walk-file parsing. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Walk } from "../src/session.js";

const fix = (t, extra = {}) => ({ t, lat: 1.2803512345678, lng: 103.8470512345678, accuracy: 8.26, ...extra });

describe("record", () => {
  test("appends compact rows, rounding coordinates to ~1 cm and accuracy to 0.1 m", () => {
    const log = Walk.record([], fix(1000), "real");
    assert.deepEqual(log, [[1000, 1.2803512, 103.8470512, 8.3, "real"]]);
  });

  test("keeps malformed values as they were, so replay sees what the engine saw", () => {
    const log = Walk.record([], fix(1000, { lat: NaN, accuracy: undefined }), "real");
    assert.ok(Number.isNaN(log[0][1]));
    assert.equal(log[0][3], undefined);
    // …and after a JSON round trip they're null, which the engine still rejects.
    assert.deepEqual(JSON.parse(JSON.stringify(log))[0].slice(1, 4), [null, 103.8470512, null]);
  });

  test("drops the oldest rows beyond the cap", () => {
    const log = [];
    for (let i = 0; i < 12; i++) Walk.record(log, fix(i), "sim", 10);
    assert.equal(log.length, 10);
    assert.equal(log[0][0], 2);
    assert.equal(log.at(-1)[0], 11);
  });

  test("the default cap holds a two-hour walk at 1 Hz", () => {
    assert.ok(Walk.CAP >= 2 * 3600);
  });
});

describe("summary", () => {
  test("counts, time span and sources", () => {
    const log = [];
    Walk.record(log, fix(5000), "real");
    Walk.record(log, fix(9000), "sim");
    Walk.record(log, fix(12000), "real");
    assert.deepEqual(Walk.summary(log), { count: 3, first: 5000, last: 12000, bySource: { real: 2, sim: 1 } });
    assert.deepEqual(Walk.summary([]), { count: 0, first: null, last: null, bySource: {} });
  });
});

describe("toWalk and parse", () => {
  const cfg = { radius: 25, accuracyCeiling: 50, consecutiveFixes: 3, extra: "not exported" };
  const locations = [{ id: "a", name: "A", lat: 1.28, lng: 103.84, radius: 22, arrivalText: "not exported" }];

  test("exports the documented shape", () => {
    const log = Walk.record([], fix(1000), "real");
    const w = Walk.toWalk(log, { title: "T", cfg, locations, exportedAt: new Date(Date.UTC(2026, 8, 16, 1, 2, 3)) });
    assert.deepEqual(w, {
      format: "chinatown-hunt-walk", version: 1, title: "T", exportedAt: "2026-09-16T01:02:03.000Z",
      cfg: { radius: 25, accuracyCeiling: 50, consecutiveFixes: 3 },
      locations: [{ id: "a", name: "A", lat: 1.28, lng: 103.84, radius: 22 }],
      fixes: [{ t: 1000, lat: 1.2803512, lng: 103.8470512, accuracy: 8.3, source: "real" }],
    });
  });

  test("round-trips through JSON text", () => {
    const log = [];
    for (let i = 0; i < 5; i++) Walk.record(log, fix(i * 1000), i % 2 ? "sim" : "real");
    const text = JSON.stringify(Walk.toWalk(log, { title: "T", cfg, locations }));
    const p = Walk.parse(text);
    assert.equal(p.fixes.length, 5);
    assert.equal(p.skipped, 0);
    assert.deepEqual(p.fixes[1], { t: 1000, lat: 1.2803512, lng: 103.8470512, accuracy: 8.3, source: "sim" });
    assert.deepEqual(p.cfg, { radius: 25, accuracyCeiling: 50, consecutiveFixes: 3 });
    assert.equal(p.locations[0].id, "a");
    assert.equal(p.title, "T");
  });

  test("accepts a bare array of fixes", () => {
    const p = Walk.parse([{ t: 1, lat: 1, lng: 2, accuracy: 3 }]);
    assert.deepEqual(p.fixes, [{ t: 1, lat: 1, lng: 2, accuracy: 3, source: "unknown" }]);
    assert.equal(p.locations, null);
    assert.equal(p.cfg, null);
  });

  test("keeps recorded order rather than sorting by time", () => {
    const p = Walk.parse([{ t: 3 }, { t: 1 }, { t: 2 }]);
    assert.deepEqual(p.fixes.map(f => f.t), [3, 1, 2]);
  });

  test("skips entries that can't be placed in time, but passes bad coordinates through", () => {
    const p = Walk.parse({ fixes: [{ t: 1, lat: null, lng: null, accuracy: null }, { lat: 1 }, null, "x", { t: "5" }, { t: 2 }] });
    assert.equal(p.fixes.length, 2);
    assert.equal(p.skipped, 4);
    assert.equal(p.fixes[0].lat, null);
  });

  test("rejects things that aren't walks, with a readable message", () => {
    assert.throws(() => Walk.parse("{not json"), /not valid JSON/);
    assert.throws(() => Walk.parse({ hello: 1 }), /no fixes array/);
    assert.throws(() => Walk.parse({ fixes: [] }), /no usable fixes/);
    assert.throws(() => Walk.parse({ fixes: [{ lat: 1 }] }), /no usable fixes/);
    assert.throws(() => Walk.parse({ format: "gpx", fixes: [{ t: 1 }] }), /unknown format/);
    assert.throws(() => Walk.parse({ format: Walk.FORMAT, version: 99, fixes: [{ t: 1 }] }), /newer/);
  });
});

describe("filename", () => {
  test("names the file with the local date and time", () => {
    assert.equal(Walk.filename(new Date(2026, 8, 6, 9, 5)), "chinatown-walk-2026-09-06-0905.json");
  });
});
