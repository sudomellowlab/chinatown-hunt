// Game rules: answering, scoring, sequencing, locking. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Play } from "../src/play.js";

const mc   = { id: "mc", type: "multiple_choice", prompt: "Which?", options: ["A", "B", "C"], answer: 1, points: 100, hint: "Not A", hintPenalty: 25 };
const txt  = { id: "tx", type: "text", prompt: "Who?", accept: ["Hokkien", "hokkien people"], points: 50 };
const num  = { id: "nm", type: "number", prompt: "When?", answer: 1842, tolerance: 1, points: 80, hintPenalty: 100 };
const loc  = { id: "thk", name: "Thian Hock Keng", tasks: [mc, txt, num] };
const other = { id: "amoy", name: "Amoy Street", tasks: [{ id: "a1", type: "text", prompt: "?", accept: ["x"] }] };
const empty = { id: "green", name: "Telok Ayer Green", tasks: [] };
const game = { locations: [loc, other, empty] };

// Play a sequence of steps against a fresh progress object.
function run(steps, progress = Play.emptyProgress()) {
  for (const s of steps) progress = typeof s === "function" ? s(progress) : progress;
  return progress;
}

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

describe("scoring", () => {
  test("a right answer earns the challenge's points; a wrong one earns 0", () => {
    const right = Play.answer(Play.emptyProgress(), mc, 1);
    assert.deepEqual(right.result, { correct: true, points: 100, hint: false });
    const wrong = Play.answer(Play.emptyProgress(), mc, 2);
    assert.deepEqual(wrong.result, { correct: false, points: 0, hint: false });
  });

  test("a hint costs its penalty, and a right answer after a hint earns the rest", () => {
    const p = Play.revealHint(Play.emptyProgress(), "mc");
    assert.equal(Play.answer(p, mc, 1).result.points, 75);
  });

  test("a hint never takes points below zero, and a wrong answer after a hint is 0 not negative", () => {
    const p = Play.revealHint(Play.emptyProgress(), "nm");      // penalty 100 on an 80-point challenge
    assert.equal(Play.answer(p, num, "1842").result.points, 0);
    const q = Play.revealHint(Play.emptyProgress(), "mc");
    assert.equal(Play.answer(q, mc, 0).result.points, 0);
  });

  test("defaults: 100 points, 25 hint penalty", () => {
    const t = { id: "d", type: "text", accept: ["x"] };
    assert.equal(Play.worth(t, false), 100);
    assert.equal(Play.worth(t, true), 75);
  });

  test("one attempt: answering again changes nothing", () => {
    let p = Play.answer(Play.emptyProgress(), mc, 0).progress;
    const again = Play.answer(p, mc, 1);
    assert.equal(again.repeated, true);
    assert.deepEqual(again.progress, p);
    assert.equal(again.progress.answers.mc.points, 0);
  });

  test("a hint can't be revealed after answering", () => {
    const p = Play.answer(Play.emptyProgress(), mc, 1).progress;
    assert.deepEqual(Play.revealHint(p, "mc"), p);
  });

  test("location and total scores", () => {
    let p = Play.emptyProgress();
    p = Play.answer(p, mc, 1).progress;                // 100
    p = Play.revealHint(p, "tx");
    p = Play.answer(p, txt, "hokkien").progress;       // 50 - 25 = 25
    p = Play.answer(p, num, "1900").progress;          // 0
    assert.deepEqual(Play.locationScore(loc, p), { score: 125, max: 230, correct: 2, total: 3 });
    assert.equal(Play.totalScore(p), 125);
  });

  test("points for a challenge later deleted from the game still count in the total", () => {
    let p = Play.answer(Play.emptyProgress(), mc, 1).progress;
    const trimmed = { ...loc, tasks: [txt, num] };
    assert.equal(Play.locationScore(trimmed, p).score, 0);
    assert.equal(Play.totalScore(p), 100);
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
    assert.deepEqual(Play.stage(loc, p), { kind: "summary", score: 80, max: 230, correct: 1, total: 3 });
  });

  test("a location with no challenges goes straight from arrival to summary", () => {
    let p = Play.startChallenges(Play.activate(Play.emptyProgress(), "green"), "green");
    assert.equal(Play.stage(empty, p).kind, "summary");
  });

  test("a new challenge added after a team finished part of a location is simply next", () => {
    let p = Play.startChallenges(Play.emptyProgress(), "thk");
    p = Play.answer(p, mc, 1).progress;
    const extra = { id: "new", type: "text", prompt: "Added", accept: ["y"] };
    const edited = { ...loc, tasks: [mc, extra, txt, num] };
    assert.equal(Play.stage(edited, p).task.id, "new");
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
    assert.deepEqual(p, snapshot);
  });
});

describe("reconcile", () => {
  test("fills in missing fields and drops locations the game no longer has", () => {
    const p = Play.reconcile({ active: "gone", completed: ["thk", "gone"], answers: { mc: { correct: true, points: 100 } } }, game);
    assert.deepEqual(p, { active: null, completed: ["thk"], answers: { mc: { correct: true, points: 100 } }, hints: {}, intro: {} });
  });
  test("an active location that's also completed is no longer active", () => {
    assert.equal(Play.reconcile({ active: "thk", completed: ["thk"] }, game).active, null);
  });
  test("survives garbage", () => {
    assert.deepEqual(Play.reconcile({ completed: "x", answers: 5 }, game), Play.emptyProgress());
  });
});

describe("validation", () => {
  test("the sample challenges are valid", () => {
    for (const t of [mc, txt, num]) assert.deepEqual(Play.validateTask(t), [], t.id);
  });

  test("names each problem in plain words", () => {
    assert.deepEqual(Play.validateTask({ type: "multiple_choice", prompt: " ", options: ["A", ""], answer: 5 }),
      ["the question is empty", "needs at least two options", "an option is empty", "mark the correct option"]);
    assert.deepEqual(Play.validateTask({ type: "text", prompt: "Q", accept: ["", " ! "] }), ["add at least one accepted answer"]);
    assert.deepEqual(Play.validateTask({ type: "number", prompt: "Q", answer: "abc", tolerance: -1 }),
      ["the answer must be a number", "the tolerance must be 0 or more"]);
    assert.deepEqual(Play.validateTask({ type: "nope", prompt: "Q" }), ["choose a challenge type"]);
    assert.deepEqual(Play.validateTask({ ...mc, points: -5, hintPenalty: NaN }), ["points must be 0 or more", "the hint cost must be 0 or more"]);
  });

  test("validateGame says where each problem is, including duplicate ids", () => {
    const bad = { locations: [{ name: "Amoy Street", tasks: [txt, { ...mc, id: "tx", answer: null }] }] };
    assert.deepEqual(Play.validateGame(bad), [
      "Amoy Street, challenge 2: duplicate id tx",
      "Amoy Street, challenge 2: mark the correct option",
    ]);
  });

  test("newTaskId never repeats an id already in the game", () => {
    const seq = [0, 0, 0.5];
    const id = Play.newTaskId({ locations: [{ tasks: [{ id: "t-00000000" }] }] }, () => seq.shift());
    assert.equal(id, "t-" + Math.floor(0.5 * 36 ** 8).toString(36));
  });
});
