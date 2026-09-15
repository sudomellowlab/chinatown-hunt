// Hand-placed POI edits. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Poi } from "../src/poi.js";

describe("parseCoords", () => {
  test("plain decimal pairs, with comma or space", () => {
    assert.deepEqual(Poi.parseCoords("1.28092, 103.84760"), { lat: 1.28092, lng: 103.8476 });
    assert.deepEqual(Poi.parseCoords("  1.28092,103.8476 "), { lat: 1.28092, lng: 103.8476 });
    assert.deepEqual(Poi.parseCoords("1.28092 103.8476"), { lat: 1.28092, lng: 103.8476 });
    assert.deepEqual(Poi.parseCoords("-33.8568, 151.2153"), { lat: -33.8568, lng: 151.2153 });
  });

  test("Google Maps links: the place pin wins over the map centre", () => {
    assert.deepEqual(Poi.parseCoords("https://www.google.com/maps/@1.2809,103.8476,19z"), { lat: 1.2809, lng: 103.8476 });
    assert.deepEqual(
      Poi.parseCoords("https://www.google.com/maps/place/Thian+Hock+Keng/@1.2811,103.8470,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d1.28092!4d103.8476"),
      { lat: 1.28092, lng: 103.8476 });
    assert.deepEqual(Poi.parseCoords("https://maps.google.com/?q=1.28092,103.8476"), { lat: 1.28092, lng: 103.8476 });
  });

  test("rejects anything else with a readable message", () => {
    for (const bad of ["", "Thian Hock Keng", "1.28", "1°16'51\"N 103°50'51\"E", "abc, def"])
      assert.throws(() => Poi.parseCoords(bad), /decimal coordinates/, bad);
    assert.throws(() => Poi.parseCoords("103.84, 1.28"), /latitude must be within/);
  });
});

describe("edit", () => {
  const base = { id: "thk", lat: 1.28092, lng: 103.8476, radius: 22 };

  test("records the change against the original GAME values", () => {
    const e = Poi.edit({}, base, { lat: 1.2810001234, lng: 103.8477 });
    assert.deepEqual(e, { thk: { base: { lat: 1.28092, lng: 103.8476, radius: 22 }, value: { lat: 1.281, lng: 103.8477, radius: 22 } } });
  });

  test("later changes build on the earlier edit but keep the original base", () => {
    let e = Poi.edit({}, base, { lat: 1.281 });
    e = Poi.edit(e, base, { radius: 30 });
    assert.deepEqual(e.thk.value, { lat: 1.281, lng: 103.8476, radius: 30 });
    assert.deepEqual(e.thk.base, { lat: 1.28092, lng: 103.8476, radius: 22 });
  });

  test("moving a location back to its GAME values removes the edit", () => {
    let e = Poi.edit({}, base, { radius: 30 });
    e = Poi.edit(e, base, { radius: 22 });
    assert.deepEqual(e, {});
  });

  test("does not mutate the edits passed in", () => {
    const before = Poi.edit({}, base, { radius: 30 });
    const snapshot = structuredClone(before);
    Poi.edit(before, base, { radius: 40 });
    assert.deepEqual(before, snapshot);
  });

  test("a location with no radius of its own can be given one", () => {
    const e = Poi.edit({}, { id: "x", lat: 1, lng: 2 }, { radius: 18 });
    assert.deepEqual(e.x, { base: { lat: 1, lng: 2, radius: null }, value: { lat: 1, lng: 2, radius: 18 } });
  });
});

describe("apply", () => {
  const game = [
    { id: "a", name: "A", lat: 1.28, lng: 103.84, radius: 22, arrivalText: "kept" },
    { id: "b", name: "B", lat: 1.29, lng: 103.85 },
  ];

  test("applies edits whose base still matches GAME, keeping other fields", () => {
    const edits = Poi.edit(Poi.edit({}, game[0], { lat: 1.281, radius: 30 }), game[1], { radius: 15 });
    const r = Poi.apply(game, edits);
    assert.deepEqual(r.applied, ["a", "b"]);
    assert.deepEqual(r.locations[0], { id: "a", name: "A", lat: 1.281, lng: 103.84, radius: 30, arrivalText: "kept" });
    assert.equal(r.locations[1].radius, 15);
    assert.deepEqual(r.edits, edits);
  });

  test("drops edits made against coordinates GAME no longer has", () => {
    const edits = Poi.edit({}, game[0], { lat: 1.281 });
    const updatedGame = [{ ...game[0], lat: 1.2805 }, game[1]];     // new coordinates deployed since
    const r = Poi.apply(updatedGame, edits);
    assert.deepEqual(r.stale, ["a"]);
    assert.equal(r.locations[0].lat, 1.2805);
    assert.deepEqual(r.edits, {});
  });

  test("ignores edits for locations that no longer exist, and malformed entries", () => {
    const r = Poi.apply(game, { gone: { base: { lat: 0, lng: 0, radius: null }, value: { lat: 1, lng: 1, radius: null } }, a: { junk: true } });
    assert.deepEqual(r.unknown, ["gone"]);
    assert.deepEqual(r.stale, ["a"]);
    assert.deepEqual(r.edits, {});
    assert.deepEqual(r.locations, game);
  });

  test("never mutates GAME", () => {
    const snapshot = structuredClone(game);
    Poi.apply(game, Poi.edit({}, game[0], { lat: 5 }));
    assert.deepEqual(game, snapshot);
  });
});
