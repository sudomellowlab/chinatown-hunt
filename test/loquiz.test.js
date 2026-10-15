// LoQuiz sync rules: which links an answer hits, and what it does to a team's progress. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Play } from "../src/play.js";
import { LoQuiz } from "../src/loquiz.js";

const at = { lat: 1.28, lng: 103.84 };
const link = (taskId, correctOnly = true) => [{ taskId, correctOnly }];
const t1 = { id: "t1", prompt: "First", loquiz: link("Q1") };
const t2 = { id: "t2", prompt: "Second", answer: { kind: "text", accept: ["dragon"] }, loquiz: link("Q2") };
const t3 = { id: "t3", prompt: "Third", loquiz: link("Q3") };
const thk = { id: "thk", name: "Thian Hock Keng", ...at, loquizOpen: link("OPEN-THK"), tasks: [t1, t2, t3] };
const amoy = { id: "amoy", name: "Amoy Street", ...at, loquizOpen: link("OPEN-AMOY", false), tasks: [{ id: "a1", prompt: "?", loquiz: link("QA1") }] };
const s1 = { id: "s1", prompt: "Intro", loquiz: link("QS1") }, s2 = { id: "s2", prompt: "Code", answer: { kind: "number", accept: ["419562"] }, loquiz: link("QS2") };
const game = {
  title: "Test hunt", durationMinutes: 120, revealMinutes: 20, locations: [thk, amoy],
  start: { name: "Briefing", password: "red lantern", loquizUnlock: link("UNLOCK"), tasks: [s1, s2] },
  clues: [], suspects: [],
};
const begun = () => Play.begin(game, Play.emptyProgress());
const afterStart = () => ({ ...begun(), start: "done" });

describe("finding what a LoQuiz question is linked to", () => {
  test("each kind of link is found, in game order", () => {
    assert.deepEqual(LoQuiz.hits(game, "UNLOCK").map(h => h.kind), ["unlock"]);
    assert.deepEqual(LoQuiz.hits(game, "OPEN-THK").map(h => [h.kind, h.locId]), [["open", "thk"]]);
    assert.deepEqual(LoQuiz.hits(game, "Q2").map(h => [h.kind, h.locId, h.index]), [["task", "thk", 1]]);
    assert.deepEqual(LoQuiz.hits(game, "QS2").map(h => [h.kind, h.locId, h.index]), [["task", Play.START, 1]]);
    assert.deepEqual(LoQuiz.hits(game, "NOPE"), []);
  });
  test("one question can be linked in two places, e.g. finishing one location and opening the next", () => {
    const g = { ...game, locations: [thk, { ...amoy, loquizOpen: link("Q3") }] };
    assert.deepEqual(LoQuiz.hits(g, "Q3").map(h => [h.kind, h.locId]), [["task", "thk"], ["open", "amoy"]], "finish first, then open the next");
  });
  test("a sealed starting challenge has no challenges to find until it's unlocked", () => {
    const sealed = { ...game, start: { name: "Briefing", sealed: "vault1.x", loquizUnlock: link("UNLOCK") } };
    assert.deepEqual(LoQuiz.hits(sealed, "QS1"), []);
    assert.deepEqual(LoQuiz.hits(sealed, "UNLOCK").map(h => h.kind), ["unlock"]);
  });
  test("links are cleaned: empty ids dropped, correctOnly defaults to on", () => {
    assert.deepEqual(LoQuiz.links([{ taskId: " Q1 " }, { taskId: "" }, null, { taskId: "Q2", correctOnly: false }]),
      [{ taskId: "Q1", correctOnly: true }, { taskId: "Q2", correctOnly: false }]);
    assert.deepEqual(LoQuiz.links(undefined), []);
  });
  test("a wrong answer only counts for a link that takes any answer", () => {
    assert.equal(LoQuiz.counts({ correctOnly: true }, { correct: false }), false);
    assert.equal(LoQuiz.counts({ correctOnly: true }, { correct: true }), true);
    assert.equal(LoQuiz.counts({ correctOnly: false }, { correct: false }), true);
  });
});

describe("opening a location from LoQuiz", () => {
  test("opens it as if the team had walked in", () => {
    const p = LoQuiz.open(afterStart(), game, "thk");
    assert.equal(p.active, "thk");
    assert.equal(Play.stage(thk, p).kind, "arrival");
  });
  test("finishes the location the phone was still showing", () => {
    const p = LoQuiz.open({ ...afterStart(), active: "amoy" }, game, "thk");
    assert.equal(p.active, "thk");
    assert.deepEqual(p.completed, ["amoy"]);
  });
  test("LoQuiz being past the starting challenge counts it as done", () => {
    const p = LoQuiz.open({ ...begun(), start: "open" }, game, "thk");
    assert.equal(p.start, "done");
    assert.equal(p.active, "thk");
  });
  test("a finished location never opens again, and nothing opens once the clues are up", () => {
    const done = { ...afterStart(), completed: ["thk"] };
    assert.equal(LoQuiz.open(done, game, "thk"), done);
    const revealed = { ...afterStart(), revealed: true };
    assert.equal(LoQuiz.open(revealed, game, "thk"), revealed);
  });
  test("opening the one already open changes nothing", () => {
    const p = LoQuiz.open(afterStart(), game, "thk");
    assert.equal(LoQuiz.open(p, game, "thk"), p);
  });
});

describe("moving past a challenge from LoQuiz", () => {
  test("goes on to the next challenge", () => {
    let p = LoQuiz.open(afterStart(), game, "thk");
    p = LoQuiz.pass(p, game, "thk", 0);
    assert.equal(Play.stage(thk, p).index, 1);
  });
  test("a challenge with an answer here counts as answered, so Next isn't blocked", () => {
    let p = LoQuiz.pass(LoQuiz.open(afterStart(), game, "thk"), game, "thk", 1);
    assert.equal(p.solved.t2, LoQuiz.ANSWERED);
    assert.ok(Play.isSolved(p, t2));
    assert.equal(Play.stage(thk, p).index, 2);
  });
  test("skipping ahead counts every earlier challenge as answered", () => {
    const p = LoQuiz.pass(LoQuiz.open(afterStart(), game, "thk"), game, "thk", 2);
    assert.equal(p.solved.t2, LoQuiz.ANSWERED);
  });
  test("an answer the team already gave here is kept", () => {
    let p = LoQuiz.open(afterStart(), game, "thk");
    p = Play.solve(Play.goTo(p, thk, 1), t2, "Dragon");
    p = LoQuiz.pass(p, game, "thk", 1);
    assert.equal(p.solved.t2, "Dragon");
  });
  test("the last challenge finishes the location", () => {
    const p = LoQuiz.pass(LoQuiz.open(afterStart(), game, "thk"), game, "thk", 2);
    assert.equal(p.active, null);
    assert.deepEqual(p.completed, ["thk"]);
  });
  test("a challenge at a location that isn't open yet opens it first (GPS was slow)", () => {
    const p = LoQuiz.pass(afterStart(), game, "thk", 0);
    assert.equal(p.active, "thk");
    assert.equal(Play.stage(thk, p).index, 1);
  });
  test("never goes backwards", () => {
    const p = Play.goTo(LoQuiz.open(afterStart(), game, "thk"), thk, 2);
    assert.equal(LoQuiz.pass(p, game, "thk", 0), p);
  });
  test("a finished location stays finished", () => {
    const p = { ...afterStart(), completed: ["thk"] };
    assert.equal(LoQuiz.pass(p, game, "thk", 1), p);
  });
  test("an index past the end does nothing", () => {
    const p = LoQuiz.open(afterStart(), game, "thk");
    assert.equal(LoQuiz.pass(p, game, "thk", 9), p);
  });
});

describe("the starting challenge from LoQuiz", () => {
  test("its challenges move on once it's unlocked, and the last one finishes it", () => {
    let p = Play.unlockStart(begun());
    p = LoQuiz.pass(p, game, Play.START, 0);
    assert.equal(Play.startStage(game.start, p).index, 1);
    p = LoQuiz.pass(p, game, Play.START, 1);
    assert.equal(p.start, "done");
    assert.equal(p.solved.s2, LoQuiz.ANSWERED);
  });
  test("nothing moves while it's still locked: the password has to open it first", () => {
    const p = begun();
    assert.equal(LoQuiz.pass(p, game, Play.START, 0), p);
  });
  test("once done, it stays done", () => {
    const p = afterStart();
    assert.equal(LoQuiz.pass(p, game, Play.START, 1), p);
  });
});
