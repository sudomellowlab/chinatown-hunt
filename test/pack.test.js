// Scrambled game content for the participant file. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Pack } from "../src/pack.js";

const game = {
  id: "chinatown-historical-hunt",
  title: "Historical Hunt — Chinatown",
  locations: [{ id: "thk", name: "Thian Hock Keng Temple", lat: 1.28092, lng: 103.8476, radius: 22, arrivalText: "Temple of Heavenly Happiness 天福宫" }],
  culprit: "s2",
  tasks: [{ answer: 1839, accept: ["hokkien", "hokkien people"] }],
};

describe("Pack", () => {
  test("round-trips the game exactly, including non-ASCII text", () => {
    assert.deepEqual(Pack.open(Pack.seal(game)), game);
  });

  test("gives nothing away when read as text", () => {
    const sealed = Pack.seal(game);
    for (const secret of ["Thian Hock Keng", "Temple", "hokkien", "1839", "culprit", "arrivalText", "103.8476"])
      assert.ok(!sealed.includes(secret), `sealed text contains "${secret}"`);
    assert.ok(!Buffer.from(sealed.split(".")[2], "base64").toString("latin1").includes("Thian"), "the payload isn't plain base64 JSON");
  });

  test("is safe to paste inside a JS string in an HTML page", () => {
    assert.match(Pack.seal(game), /^cth1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  });

  test("a fresh key each time, so two exports of the same game differ", () => {
    assert.notEqual(Pack.seal(game), Pack.seal(game));
  });

  test("a fixed key gives a fixed result", () => {
    const key = new Uint8Array(16).fill(7);
    assert.equal(Pack.seal(game, key), Pack.seal(game, key));
  });

  test("handles a large game", () => {
    const big = { locations: Array.from({ length: 200 }, (_, i) => ({ id: `l${i}`, text: "x".repeat(2000) })) };
    assert.deepEqual(Pack.open(Pack.seal(big)), big);
  });

  test("refuses things that aren't packs, and damaged packs", () => {
    assert.throws(() => Pack.open("hello"), /not a game pack/);
    assert.throws(() => Pack.open("cth1.!!!.abc"), /not a game pack/);
    const sealed = Pack.seal(game), [p, k, d] = sealed.split(".");
    const damaged = Buffer.from(d, "base64"); damaged[3] ^= 0xff; damaged[10] ^= 0x55;
    assert.throws(() => Pack.open(`${p}.${k}.${damaged.toString("base64")}`), /damaged/);
    assert.throws(() => Pack.open(`${p}.${Buffer.alloc(16, 1).toString("base64")}.${d}`), /damaged/);
  });
});
