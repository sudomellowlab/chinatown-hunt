// Game rules: answering, sequencing, locking, the timed reveal, validation. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Play } from "../src/play.js";

const mc   = { id: "mc", type: "multiple_choice", prompt: "Which?", options: ["A", "B", "C"], answer: 1, hint: "Not A" };
const txt  = { id: "tx", type: "text", prompt: "Who?", accept: ["Hokkien", "hokkien people"] };
const num  = { id: "nm", type: "number", prompt: "When?", answer: 1842, tolerance: 1 };
const at = { lat: 1.28, lng: 103.84 };
const loc  = { id: "thk", name: "Thian Hock Keng", ...at, tasks: [mc, txt, num] };
const other = { id: "amoy", name: "Amoy Street", ...at, tasks: [{ id: "a1", type: "text", prompt: "?", accept: ["x"] }] };
const empty = { id: "green", name: "Telok Ayer Green", ...at, tasks: [] };
const MIN = 60000;
const game = {
  title: "Test hunt", durationMinutes: 120, revealMinutes: 20, locations: [loc, other, empty],
  clues: [{ id: "c1", text: "A clue" }], suspects: [{ id: "s1", name: "Someone", blurb: "" }],
};

describe("checking answers", () => {
  test("multiple choice: only the marked option, by index", () => {
    assert.equal(Play.isCorrect(mc, 1), true);
    assert.equal(Play.isCorrect(mc, 0), false);
    assert.equal(Play.isCorrect(mc, "1"), false);
    assert.equal(Play.isCorrect(mc, undefined), false);
  });

  test("text: any accepted answer, ignoring case, punctuation, spacing and extra symbols", () => {
    for (const ok of ["hokkien", "  HOKKIEN ", "Hokkien!", "hokkien   people", "Hokkien-people", "“Hokkien”"])
      assert.equal(Play.isCorrect(txt, ok), true, ok);
    for (const bad of ["hokkiens", "teochew", "", "   ", "!!!", null])
      assert.equal(Play.isCorrect(txt, bad), false, String(bad));
  });

  test("text: works for answers in other scripts", () => {
    assert.equal(Play.isCorrect({ type: "text", accept: ["天福宫"] }, " 天福宫。"), true);
  });

  test("number: within the tolerance, accepting common formatting", () => {
    for (const ok of ["1842", "1841", "1843", " 1,842 ", "1842.0", "1 842"]) assert.equal(Play.isCorrect(num, ok), true, ok);
    for (const bad of ["1840", "1844", "eighteen forty-two", "", "1842a", "--1842"]) assert.equal(Play.isCorrect(num, bad), false, bad);
    assert.equal(Play.isCorrect({ type: "number", answer: 8 }, "8"), true);
    assert.equal(Play.isCorrect({ type: "number", answer: 8 }, "9"), false, "no tolerance means exact");
  });
});

describe("answering", () => {
  test("records whether it was right, whether a hint was used, and when; nothing about points", () => {
    let p = Play.revealHint(Play.emptyProgress(), "mc");
    p = Play.answer(p, mc, 1, 1234).progress;
    p = Play.answer(p, txt, "nope", 5678).progress;
    assert.deepEqual(p.answers, {
      mc: { correct: true, hint: true, at: 1234 },
      tx: { correct: false, hint: false, at: 5678 },
    });
    assert.ok(!JSON.stringify(p).includes("point"));
  });

  test("one attempt: answering again changes nothing", () => {
    const p = Play.answer(Play.emptyProgress(), mc, 0).progress;
    const again = Play.answer(p, mc, 1);
    assert.equal(again.repeated, true);
    assert.deepEqual(again.progress, p);
  });

  test("a hint can't be revealed after answering", () => {
    const p = Play.answer(Play.emptyProgress(), mc, 1).progress;
    assert.deepEqual(Play.revealHint(p, "mc"), p);
  });
});

describe("sequence at a location", () => {
  test("arrival first, then the challenges strictly in order, then the summary", () => {
    let p = Play.activate(Play.emptyProgress(), "thk");
    assert.equal(Play.stage(loc, p).kind, "arrival");
    p = Play.startChallenges(p, "thk");
    assert.deepEqual(Play.stage(loc, p), { kind: "task", task: mc, index: 0, total: 3, hintShown: false });
    p = Play.answer(p, mc, 0).progress;
    assert.equal(Play.stage(loc, p).task, txt);
    p = Play.revealHint(p, "tx");
    assert.equal(Play.stage(loc, p).hintShown, true);
    p = Play.answer(p, txt, "nope").progress;
    assert.equal(Play.stage(loc, p).index, 2);
    p = Play.answer(p, num, "1842").progress;
    assert.deepEqual(Play.stage(loc, p), { kind: "summary", total: 3 });
  });

  test("a location with no challenges goes straight from arrival to summary", () => {
    const p = Play.startChallenges(Play.activate(Play.emptyProgress(), "green"), "green");
    assert.equal(Play.stage(empty, p).kind, "summary");
  });

  test("a new challenge added after a team finished part of a location is simply next", () => {
    let p = Play.startChallenges(Play.emptyProgress(), "thk");
    p = Play.answer(p, mc, 1).progress;
    const extra = { id: "new", type: "text", prompt: "Added", accept: ["y"] };
    assert.equal(Play.stage({ ...loc, tasks: [mc, extra, txt, num] }, p).task.id, "new");
  });
});

describe("one location at a time", () => {
  test("while a location is active, it is the only one that can open", () => {
    const p = Play.activate(Play.emptyProgress(), "thk");
    assert.deepEqual(Play.openable(game.locations, p).map(l => l.id), ["thk"]);
  });

  test("activating another location while one is active does nothing", () => {
    const p = Play.activate(Play.emptyProgress(), "thk");
    assert.equal(Play.activate(p, "amoy").active, "thk");
  });

  test("finishing needs every challenge answered, then frees the map", () => {
    let p = Play.startChallenges(Play.activate(Play.emptyProgress(), "thk"), "thk");
    p = Play.answer(p, mc, 1).progress;
    assert.equal(Play.finish(p, loc).active, "thk", "not finished with challenges left");
    p = Play.answer(p, txt, "x").progress;
    p = Play.answer(p, num, "0").progress;
    p = Play.finish(p, loc);
    assert.equal(p.active, null);
    assert.deepEqual(p.completed, ["thk"]);
    assert.deepEqual(Play.openable(game.locations, p).map(l => l.id), ["amoy", "green"]);
  });

  test("a completed location can't be activated again", () => {
    const p = { ...Play.emptyProgress(), completed: ["thk"] };
    assert.equal(Play.activate(p, "thk").active, null);
  });

  test("transitions never mutate the progress they're given", () => {
    const p = Play.activate(Play.emptyProgress(), "thk");
    const snapshot = structuredClone(p);
    Play.startChallenges(p, "thk"); Play.revealHint(p, "mc"); Play.answer(p, mc, 1); Play.finish(p, loc);
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
    let p = Play.startChallenges(Play.activate(fresh, "thk"), "thk");
    assert.equal(Play.phase(game, p, 10 * MIN), "closing");
    assert.deepEqual(Play.openable(game.locations, p, true).map(l => l.id), ["thk"]);
    assert.equal(Play.reveal(game, p, 10 * MIN).revealed, false, "not while the location is in progress");
    for (const t of loc.tasks) p = Play.answer(p, t, "x").progress;
    p = Play.finish(p, loc);
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
    const p = Play.reconcile({ active: "gone", completed: ["thk", "gone"], answers: { mc: { correct: true } } }, game);
    assert.deepEqual(p, { active: null, completed: ["thk"], answers: { mc: { correct: true } }, hints: {}, intro: {}, revealed: false });
  });
  test("an active location that's also completed is no longer active", () => {
    assert.equal(Play.reconcile({ active: "thk", completed: ["thk"] }, game).active, null);
  });
  test("keeps the reveal, and survives garbage", () => {
    assert.equal(Play.reconcile({ revealed: true }, game).revealed, true);
    assert.deepEqual(Play.reconcile({ completed: "x", answers: 5, revealed: "yes" }, game), Play.emptyProgress());
  });
});

describe("validation", () => {
  test("the sample game is valid", () => {
    for (const t of [mc, txt, num]) assert.deepEqual(Play.validateTask(t), [], t.id);
    assert.deepEqual(Play.validateGame(game), []);
  });

  test("names each challenge problem in plain words", () => {
    assert.deepEqual(Play.validateTask({ type: "multiple_choice", prompt: " ", options: ["A", ""], answer: 5 }),
      ["the question is empty", "needs at least two options", "an option is empty", "mark the correct option"]);
    assert.deepEqual(Play.validateTask({ type: "text", prompt: "Q", accept: ["", " ! "] }), ["add at least one accepted answer"]);
    assert.deepEqual(Play.validateTask({ type: "number", prompt: "Q", answer: "abc", tolerance: -1 }),
      ["the answer must be a number", "the tolerance must be 0 or more"]);
    assert.deepEqual(Play.validateTask({ type: "nope", prompt: "Q" }), ["choose a challenge type"]);
  });

  test("validateGame says where each problem is, including duplicate ids", () => {
    const bad = { ...game, locations: [{ id: "amoy", name: "Amoy Street", ...at, tasks: [txt, { ...mc, id: "tx", answer: null }] }] };
    assert.deepEqual(Play.validateGame(bad), [
      "Amoy Street, challenge 2: duplicate id tx",
      "Amoy Street, challenge 2: mark the correct option",
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
    assert.deepEqual(Play.validateTask({ ...mc, image: "http://x.sg/a.jpg" }), ["the image link must start with https:// (phones block http images)"]);
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
