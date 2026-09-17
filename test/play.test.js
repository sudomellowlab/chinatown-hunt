// Game rules: stepping through a location, locking, the timed reveal, validation. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Play } from "../src/play.js";

const at = { lat: 1.28, lng: 103.84 };
const t1 = { id: "t1", prompt: "First" }, t2 = { id: "t2", prompt: "Second", image: "https://a.sg/2.jpg" }, t3 = { id: "t3", prompt: "Third" };
const loc  = { id: "thk", name: "Thian Hock Keng", ...at, tasks: [t1, t2, t3] };
const other = { id: "amoy", name: "Amoy Street", ...at, tasks: [{ id: "a1", prompt: "?" }] };
const empty = { id: "green", name: "Telok Ayer Green", ...at, tasks: [] };
const MIN = 60000;
const game = {
  title: "Test hunt", durationMinutes: 120, revealMinutes: 20, locations: [loc, other, empty],
  clues: [{ id: "c1", text: "A clue" }], suspects: [{ id: "s1", name: "Someone", blurb: "" }],
};
const open = () => Play.activate(Play.emptyProgress(), "thk");

describe("stepping through a location", () => {
  test("arrival text first, then each challenge in order with Next", () => {
    let p = open();
    assert.deepEqual(Play.stage(loc, p), { kind: "arrival", total: 3 });
    p = Play.next(p, loc);
    assert.deepEqual(Play.stage(loc, p), { kind: "task", task: t1, index: 0, total: 3, last: false });
    p = Play.next(p, loc);
    assert.equal(Play.stage(loc, p).task, t2);
    p = Play.next(p, loc);
    assert.deepEqual(Play.stage(loc, p), { kind: "task", task: t3, index: 2, total: 3, last: true });
    assert.equal(Play.stage(loc, Play.next(p, loc)).index, 2, "Next on the last one stays there");
  });

  test("Back goes to the previous challenge, and from the first back to the arrival text", () => {
    let p = Play.goTo(open(), loc, 2);
    p = Play.back(p, loc);
    assert.equal(Play.stage(loc, p).index, 1);
    p = Play.back(Play.back(p, loc), loc);
    assert.equal(Play.stage(loc, p).kind, "arrival");
    assert.deepEqual(Play.back(p, loc), p, "Back on the arrival text does nothing");
  });

  test("Finish is only possible on the last challenge", () => {
    let p = open();
    assert.equal(Play.canFinish(loc, p), false);
    assert.deepEqual(Play.finish(p, loc), p);
    p = Play.goTo(p, loc, 1);
    assert.equal(Play.canFinish(loc, p), false);
    p = Play.next(p, loc);
    assert.equal(Play.canFinish(loc, p), true);
    p = Play.finish(p, loc);
    assert.equal(p.active, null);
    assert.deepEqual(p.completed, ["thk"]);
  });

  test("a location with no challenges finishes from its arrival text", () => {
    const p = Play.activate(Play.emptyProgress(), "green");
    assert.deepEqual(Play.stage(empty, p), { kind: "arrival", total: 0 });
    assert.deepEqual(Play.stage(empty, Play.next(p, empty)), { kind: "arrival", total: 0 });
    assert.equal(Play.canFinish(empty, p), true);
    assert.deepEqual(Play.finish(p, empty).completed, ["green"]);
  });

  test("a location that isn't the open one can't be finished", () => {
    const p = Play.goTo(Play.emptyProgress(), loc, 2);
    assert.equal(Play.canFinish(loc, p), false);
  });

  test("a re-uploaded game with fewer challenges keeps the team on the last one that exists", () => {
    const p = Play.goTo(open(), loc, 2);
    const shorter = { ...loc, tasks: [t1, t2] };
    assert.deepEqual(Play.stage(shorter, p), { kind: "task", task: t2, index: 1, total: 2, last: true });
    assert.equal(Play.canFinish(shorter, p), true);
  });

  test("nothing about answers, hints or points is stored", () => {
    let p = Play.finish(Play.goTo(open(), loc, 2), loc);
    assert.deepEqual(Object.keys(p).sort(), ["active", "at", "completed", "revealed"]);
    assert.ok(!/answer|hint|point|correct/i.test(JSON.stringify(p)));
  });
});

describe("one location at a time", () => {
  test("while a location is active, it is the only one that can open", () => {
    assert.deepEqual(Play.openable(game.locations, open()).map(l => l.id), ["thk"]);
  });

  test("activating another location while one is active does nothing", () => {
    assert.equal(Play.activate(open(), "amoy").active, "thk");
  });

  test("finishing frees the map for the rest", () => {
    const p = Play.finish(Play.goTo(open(), loc, 2), loc);
    assert.deepEqual(Play.openable(game.locations, p).map(l => l.id), ["amoy", "green"]);
  });

  test("a completed location can't be activated again", () => {
    const p = { ...Play.emptyProgress(), completed: ["thk"] };
    assert.equal(Play.activate(p, "thk").active, null);
  });

  test("transitions never mutate the progress they're given", () => {
    const p = Play.goTo(open(), loc, 1);
    const snapshot = structuredClone(p);
    Play.next(p, loc); Play.back(p, loc); Play.goTo(p, loc, -1); Play.finish(Play.goTo(p, loc, 2), loc);
    Play.reveal(game, p, 0);
    assert.deepEqual(p, snapshot);
  });
});

describe("the clues & suspects reveal", () => {
  const fresh = Play.emptyProgress();

  test("before Begin, and until revealMinutes are left, the game is in play", () => {
    assert.equal(Play.phase(game, fresh, null), "play");
    assert.equal(Play.phase(game, fresh, 120 * MIN), "play");
    assert.equal(Play.phase(game, fresh, 20 * MIN + 1), "play");
  });

  test("at revealMinutes left the reveal is due; with nothing in progress it shows", () => {
    assert.equal(Play.phase(game, fresh, 20 * MIN), "reveal");
    assert.equal(Play.phase(game, fresh, 0), "reveal");
    assert.equal(Play.phase(game, fresh, -5 * MIN), "reveal");
  });

  test("once due, no new location can open", () => {
    assert.deepEqual(Play.openable(game.locations, fresh, Play.revealDue(game, fresh, 20 * MIN)), []);
    assert.equal(Play.activate({ ...fresh, revealed: true }, "thk").active, null);
  });

  test("a team part-way through a location finishes it first, then the reveal shows", () => {
    let p = Play.next(Play.activate(fresh, "thk"), loc);
    assert.equal(Play.phase(game, p, 10 * MIN), "closing");
    assert.deepEqual(Play.openable(game.locations, p, true).map(l => l.id), ["thk"]);
    assert.equal(Play.reveal(game, p, 10 * MIN).revealed, false, "not while the location is in progress");
    p = Play.finish(Play.goTo(p, loc, 2), loc);
    assert.equal(Play.phase(game, p, 9 * MIN), "reveal");
    assert.equal(Play.reveal(game, p, 9 * MIN).revealed, true);
  });

  test("finishing every location brings the reveal forward", () => {
    const done = { ...fresh, completed: ["thk", "amoy", "green"] };
    assert.equal(Play.phase(game, done, 90 * MIN), "reveal");
    assert.equal(Play.phase(game, { ...fresh, completed: ["thk", "amoy"] }, 90 * MIN), "play");
  });

  test("once revealed it stays, even if the clock were to read more time again", () => {
    const p = Play.reveal(game, fresh, 5 * MIN);
    assert.equal(p.revealed, true);
    assert.equal(Play.phase(game, p, 100 * MIN), "reveal");
    assert.deepEqual(Play.reveal(game, p, 0), p);
  });

  test("the reveal time follows the game's settings, with defaults", () => {
    assert.equal(Play.phase({ ...game, revealMinutes: 45 }, fresh, 40 * MIN), "reveal");
    assert.equal(Play.phase({ ...game, revealMinutes: 0 }, fresh, 1), "play");
    assert.equal(Play.phase({ ...game, revealMinutes: 0 }, fresh, 0), "reveal");
    assert.equal(Play.revealMs({ locations: [] }), 20 * MIN);
    assert.equal(Play.durationMs({ locations: [] }), 120 * MIN);
  });
});

describe("reconcile", () => {
  test("fills in missing fields and drops locations the game no longer has", () => {
    const p = Play.reconcile({ active: "gone", completed: ["thk", "gone"], at: { thk: 1, gone: 2, amoy: -1, green: "x" } }, game);
    assert.deepEqual(p, { active: null, completed: ["thk"], at: { thk: 1 }, revealed: false });
  });
  test("an active location that's also completed is no longer active", () => {
    assert.equal(Play.reconcile({ active: "thk", completed: ["thk"] }, game).active, null);
  });
  test("drops fields from older versions, keeps the reveal, and survives garbage", () => {
    const p = Play.reconcile({ answers: { t1: { correct: true } }, hints: {}, intro: { thk: true }, revealed: true }, game);
    assert.deepEqual(p, { active: null, completed: [], at: {}, revealed: true });
    assert.deepEqual(Play.reconcile({ completed: "x", at: 5, revealed: "yes" }, game), Play.emptyProgress());
  });
});

describe("validation", () => {
  test("the sample game is valid", () => {
    assert.deepEqual(Play.validateGame(game), []);
  });

  test("a challenge needs text or a picture, and a good picture link", () => {
    assert.deepEqual(Play.validateTask({ prompt: "Just text" }), []);
    assert.deepEqual(Play.validateTask({ prompt: "", image: "https://a.sg/p.jpg" }), []);
    assert.deepEqual(Play.validateTask({ prompt: "  " }), ["add some text or a picture"]);
    assert.deepEqual(Play.validateTask({}), ["add some text or a picture"]);
    assert.deepEqual(Play.validateTask({ prompt: "x", image: "http://a.sg/p.jpg" }), ["the image link must start with https:// (phones block http images)"]);
  });

  test("validateGame says where each problem is, including duplicate ids", () => {
    const bad = { ...game, locations: [{ id: "amoy", name: "Amoy Street", ...at, tasks: [t1, { id: "t1", prompt: "" }] }] };
    assert.deepEqual(Play.validateGame(bad), [
      "Amoy Street, challenge 2: duplicate id t1",
      "Amoy Street, challenge 2: add some text or a picture",
    ]);
  });

  test("timing, clues and suspects must be complete", () => {
    assert.deepEqual(Play.validateGame({ ...game, durationMinutes: 0, revealMinutes: -1, clues: [], suspects: [] }), [
      "Timing: the game length must be a whole number of minutes, more than 0",
      "Timing: the clues time must be a whole number of minutes, 0 or more",
      "Clues: add at least one clue",
      "Suspects: add at least one suspect",
    ]);
    assert.deepEqual(Play.validateGame({ ...game, durationMinutes: 60, revealMinutes: 90 }),
      ["Timing: the clues can't appear earlier than the start of the game"]);
    assert.deepEqual(Play.validateGame({ ...game, clues: [{ id: "c", text: " " }], suspects: [{ id: "s", name: "" }] }),
      ["Clues: clue 1 is empty", "Suspects: suspect 1 has no name"]);
  });

  test("image links must be https web addresses; none at all is fine", () => {
    assert.equal(Play.imageProblem(undefined), null);
    assert.equal(Play.imageProblem("  "), null);
    assert.equal(Play.imageProblem("https://img.example.sg/hunt/lions.jpg"), null);
    assert.match(Play.imageProblem("http://img.example.sg/lions.jpg"), /https:\/\/ \(phones block http images\)/);
    assert.match(Play.imageProblem("lions.jpg"), /isn't a web address/);
    assert.match(Play.imageProblem("ftp://x.sg/a.jpg"), /must start with https:\/\//);
    assert.deepEqual(Play.validateGame({ ...game,
      clues: [{ id: "c", text: "t", image: "nope" }], suspects: [{ id: "s", name: "n", image: "http://x/y.png" }] }), [
      "Clues: clue 1: the image link isn't a web address",
      "Suspects: suspect 1: the image link must start with https:// (phones block http images)",
    ]);
  });

  test("imageUrls lists every usable image once, in order", () => {
    const g = { locations: [{ tasks: [{ image: "https://a.sg/1.jpg" }, { image: "" }, { image: "http://bad" }] }],
      clues: [{ image: " https://a.sg/2.jpg " }, {}], suspects: [{ image: "https://a.sg/1.jpg" }] };
    assert.deepEqual(Play.imageUrls(g), ["https://a.sg/1.jpg", "https://a.sg/2.jpg"]);
  });

  test("the title and every location must be complete", () => {
    assert.deepEqual(Play.validateGame({ ...game, title: " ", locations: [] }),
      ["Game: the title is empty", "Locations: add at least one location"]);
    assert.deepEqual(Play.validateGame({ ...game, locations: [
      { id: "a", name: " ", ...at, tasks: [] },
      { id: "a", name: "Twin", lat: 95, lng: 103, radius: 0, tasks: [] },
      { name: "No id", lat: NaN, lng: 103, tasks: [] },
    ] }), [
      "Location 1: give it a name",
      "Location 2 (Twin): duplicate id",
      "Location 2 (Twin): its position is invalid",
      "Location 2 (Twin): the radius must be more than 0",
      "Location 3 (No id): missing id",
      "Location 3 (No id): its position is invalid",
    ]);
    assert.match(Play.newLocationId(game), /^l-[0-9a-z]{8}$/);
  });

  test("new ids never repeat one already taken", () => {
    const seq = [0, 0, 0.5];
    const id = Play.newTaskId({ locations: [{ tasks: [{ id: "t-00000000" }] }] }, () => seq.shift());
    assert.equal(id, "t-" + Math.floor(0.5 * 36 ** 8).toString(36));
    assert.match(Play.newId("c", []), /^c-[0-9a-z]{8}$/);
  });
});
