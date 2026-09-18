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

  test("no hints or points are stored, and no answers for challenges that have none", () => {
    let p = Play.finish(Play.goTo(open(), loc, 2), loc);
    assert.deepEqual(Object.keys(p).sort(), ["active", "at", "completed", "revealed", "solved"]);
    assert.deepEqual(p.solved, {});
    assert.ok(!/hint|point|score/i.test(JSON.stringify(p)));
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
    assert.deepEqual(p, { active: null, completed: ["thk"], at: { thk: 1 }, solved: {}, revealed: false });
  });
  test("an active location that's also completed is no longer active", () => {
    assert.equal(Play.reconcile({ active: "thk", completed: ["thk"] }, game).active, null);
  });
  test("drops fields from older versions, keeps the reveal, and survives garbage", () => {
    const p = Play.reconcile({ answers: { t1: { correct: true } }, hints: {}, intro: { thk: true }, revealed: true }, game);
    assert.deepEqual(p, { active: null, completed: [], at: {}, solved: {}, revealed: true });
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

  test("links are written [words](address) and split out of the text", () => {
    assert.deepEqual(Play.parseLinks("See the [temple's history](https://thk.sg/history) first."), [
      { text: "See the " }, { text: "temple's history", href: "https://thk.sg/history" }, { text: " first." },
    ]);
    assert.deepEqual(Play.parseLinks("[A](http://a.sg)[B](https://b.sg/x?y=1&z=2)\nend"), [
      { text: "A", href: "http://a.sg" }, { text: "B", href: "https://b.sg/x?y=1&z=2" }, { text: "\nend" },
    ]);
    assert.deepEqual(Play.parseLinks("No links [here] (https://x.sg) or [there]()."), [{ text: "No links [here] (https://x.sg) or [there]()." }]);
    assert.deepEqual(Play.parseLinks(""), []);
    assert.deepEqual(Play.parseLinks(undefined), []);
  });

  test("a link with a bad or unsafe address stays plain text and is reported", () => {
    const text = "Try [this](javascript:alert(1)) and [that](www.x.sg) and [ok](https://ok.sg).";
    assert.deepEqual(Play.parseLinks(text).filter(p => p.href).map(p => p.href), ["https://ok.sg"]);
    assert.deepEqual(Play.linkProblems(text), [
      'the link on "that" isn\'t a web address',
    ]);
    assert.deepEqual(Play.linkProblems("[x](mailto:a@b.sg) [y]()"), [
      'the link on "x" must start with https://', 'the link on "y" isn\'t a web address',
    ]);
    assert.deepEqual(Play.validateTask({ prompt: "Read [this](ftp://x.sg)" }), ['the link on "this" must start with https://']);
    assert.deepEqual(Play.validateGame({ ...game, intro: "[a](b)", revealIntro: "[c](d)",
      locations: [{ ...loc, arrivalText: "[e](f)" }, other, empty],
      clues: [{ id: "c1", text: "[g](h)" }], suspects: [{ id: "s1", name: "S", blurb: "[i](j)" }] }), [
      'Game: start screen text: the link on "a" isn\'t a web address',
      'Clues: introduction: the link on "c" isn\'t a web address',
      'Location 1 (Thian Hock Keng): arrival text: the link on "e" isn\'t a web address',
      'Clues: clue 1: the link on "g" isn\'t a web address',
      'Suspects: suspect 1: the link on "i" isn\'t a web address',
    ]);
  });

  test("new ids never repeat one already taken", () => {
    const seq = [0, 0, 0.5];
    const id = Play.newTaskId({ locations: [{ tasks: [{ id: "t-00000000" }] }] }, () => seq.shift());
    assert.equal(id, "t-" + Math.floor(0.5 * 36 ** 8).toString(36));
    assert.match(Play.newId("c", []), /^c-[0-9a-z]{8}$/);
  });
});

describe("the starting challenge", () => {
  const s1 = { id: "s-1", prompt: "Warm-up" }, s2 = { id: "s-2", prompt: "Second warm-up", image: "https://a.sg/s.jpg" };
  const start = { name: "Before you set off", arrivalText: "Welcome.", tasks: [s1, s2], password: "Red Lantern" };
  const withStart = { ...game, start };
  const begun = () => Play.begin(withStart, Play.emptyProgress());
  const unlocked = () => Play.unlockStart(begun());
  const S = Play.startAsLocation(start);

  test("Begin locks it; a game without one begins straight onto the map", () => {
    assert.equal(begun().start, "locked");
    assert.deepEqual(Play.begin(game, Play.emptyProgress()), Play.emptyProgress());
  });

  test("Begin again (Continue) never re-locks it, whatever state it's in", () => {
    for (const state of ["open", "done"]) {
      const p = { ...Play.emptyProgress(), start: state };
      assert.equal(Play.begin(withStart, p), p);
    }
  });

  test("no location can open while it is locked or open, and none can be activated", () => {
    for (const p of [begun(), unlocked()]) {
      assert.ok(Play.startPending(p));
      assert.deepEqual(Play.openable(withStart.locations, p), []);
      assert.equal(Play.activate(p, "thk"), p);
    }
  });

  test("the password opens it, and only from locked", () => {
    assert.equal(unlocked().start, "open");
    const done = { ...Play.emptyProgress(), start: "done" };
    assert.equal(Play.unlockStart(done), done);
    assert.equal(Play.unlockStart(Play.emptyProgress()).start, undefined);
  });

  test("it steps like a location: text, then each challenge; Finish only on the last", () => {
    let p = unlocked();
    assert.deepEqual(Play.stage(S, p), { kind: "arrival", total: 2 });
    assert.equal(Play.canFinishStart(start, p), false);
    p = Play.next(p, S);
    assert.equal(Play.stage(S, p).task, s1);
    assert.equal(Play.canFinishStart(start, p), false);
    assert.equal(Play.finishStart(p, start), p);
    p = Play.next(p, S);
    assert.equal(Play.stage(S, p).last, true);
    p = Play.finishStart(p, start);
    assert.equal(p.start, "done");
    assert.equal(Play.startPending(p), false);
    assert.deepEqual(Play.openable(withStart.locations, p).map(l => l.id), ["thk", "amoy", "green"]);
    assert.deepEqual(p.completed, [], "the starting challenge doesn't count as a location");
  });

  test("it can't be finished while still locked", () => {
    const p = Play.goTo(begun(), S, 1);
    assert.equal(Play.canFinishStart(start, p), false);
    assert.equal(Play.finishStart(p, start), p);
  });

  test("the clues wait for it like a location in progress", () => {
    const p = unlocked();
    assert.equal(Play.phase(withStart, p, 20 * MIN), "closing");
    assert.equal(Play.reveal(withStart, p, 20 * MIN), p);
    const done = Play.finishStart(Play.goTo(p, S, 1), start);
    assert.equal(Play.phase(withStart, done, 20 * MIN), "reveal");
  });

  test("passwords ignore case and extra spaces", () => {
    assert.equal(Play.normalizePassword("  Red   LANTERN "), "red lantern");
    assert.equal(Play.normalizePassword(null), "");
  });

  test("reconcile keeps its state and place, and releases teams if it's removed", () => {
    const p = Play.goTo(unlocked(), S, 1);
    const kept = Play.reconcile(p, withStart);
    assert.equal(kept.start, "open");
    assert.equal(kept.at[Play.START], 1);
    const gone = Play.reconcile(p, game);
    assert.equal(gone.start, undefined);
    assert.equal(gone.at[Play.START], undefined);
    assert.equal(Play.reconcile({ ...p, start: "bogus" }, withStart).start, undefined);
    const odd = Play.reconcile({ active: Play.START, completed: [Play.START, "thk"] }, withStart);
    assert.equal(odd.active, null);
    assert.deepEqual(odd.completed, ["thk"]);
  });

  test("validation: heading, password, at least one challenge, each challenge valid", () => {
    assert.deepEqual(Play.validateGame(withStart), []);
    assert.deepEqual(Play.validateGame({ ...game, start: { name: " ", password: " ab ", lockText: "[w](v)", arrivalText: "[x](y)", tasks: [] } }), [
      "Starting challenge: give it a heading",
      "Starting challenge: set a password of at least 4 characters",
      "Starting challenge: add at least one challenge",
      'Starting challenge: password screen text: the link on "w" isn\'t a web address',
      'Starting challenge: text: the link on "x" isn\'t a web address',
    ]);
    assert.deepEqual(Play.validateGame({ ...withStart, start: { ...start, tasks: [{ id: "t1", prompt: "" }] } }), [
      "Starting challenge, challenge 1: add some text or a picture",
      "Thian Hock Keng, challenge 1: duplicate id t1",
    ]);
  });

  test("its pictures are preloaded first, and new challenge ids avoid its ids", () => {
    assert.equal(Play.imageUrls(withStart)[0], "https://a.sg/s.jpg");
    const seq = [0, 0.5];
    const id = Play.newTaskId({ start: { tasks: [{ id: "t-00000000" }] }, locations: [] }, () => seq.shift());
    assert.notEqual(id, "t-00000000");
  });
});

describe("answers on a challenge", () => {
  const ask = (answer, id = "q1") => ({ id, prompt: "Which fruit?", answer });
  const text = ask({ kind: "text", accept: ["apple", "*ple*"] });
  const number = ask({ kind: "number", accept: ["1844"] }, "q2");
  const choice = ask({ kind: "choice", options: [
    { id: "o1", text: "Apple" }, { id: "o2", text: "Pear", correct: true }, { id: "o3", text: "Plum", correct: true }] }, "q3");
  const withAnswers = { id: "quiz", name: "Quiz stop", ...at, tasks: [text, number, choice] };
  const quizGame = { ...game, locations: [withAnswers, other] };

  test("a challenge without an answer behaves as before", () => {
    assert.equal(Play.needsAnswer(t1), false);
    assert.equal(Play.isSolved(Play.emptyProgress(), t1), true);
    assert.equal(Play.checkAnswer(t1, "anything"), true);
    assert.deepEqual(Play.solve(Play.emptyProgress(), t1, "x").solved, {});
  });

  test("text answers ignore capitals and extra spaces", () => {
    for (const typed of ["apple", "APPLE", " Apple ", "  apple  "]) assert.ok(Play.checkAnswer(text, typed), typed);
    for (const typed of ["app", "apples", "an apple", ""]) assert.equal(Play.checkAnswer(ask({ kind: "text", accept: ["apple"] }), typed), false, typed);
  });

  test("* stands for anything: *ple*, ple*, *ple and in the middle", () => {
    const contains = ask({ kind: "text", accept: ["*ple*"] });
    for (const typed of ["apple", "Apple", "pleasant", "a simple thing", "ple"]) assert.ok(Play.checkAnswer(contains, typed), typed);
    for (const typed of ["pear", "pie"]) assert.equal(Play.checkAnswer(contains, typed), false, typed);

    const starts = ask({ kind: "text", accept: ["ple*"] });
    assert.ok(Play.checkAnswer(starts, "please"));
    assert.equal(Play.checkAnswer(starts, "apple"), false);

    const ends = ask({ kind: "text", accept: ["*ple"] });
    assert.ok(Play.checkAnswer(ends, "apple"));
    assert.equal(Play.checkAnswer(ends, "apples"), false);

    const middle = ask({ kind: "text", accept: ["a*e"] });
    assert.ok(Play.checkAnswer(middle, "apple"));
    assert.ok(Play.checkAnswer(middle, "ae"));
    assert.equal(Play.checkAnswer(middle, "beetle"), false);
  });

  test("the rest of a pattern is taken literally, dots and brackets included", () => {
    const dotted = ask({ kind: "text", accept: ["st. andrew's"] });
    assert.ok(Play.checkAnswer(dotted, "St. Andrew's"));
    assert.equal(Play.checkAnswer(dotted, "stx andrew's"), false, "the dot is not a wildcard");
    assert.ok(Play.checkAnswer(ask({ kind: "text", accept: ["(1819)"] }), "(1819)"));
  });

  test("any of several accepted answers is right", () => {
    assert.ok(Play.checkAnswer(text, "apple"));
    assert.ok(Play.checkAnswer(text, "pineapple"), "matched by the second line");
    assert.equal(Play.checkAnswer(text, "durian"), false);
    assert.equal(Play.checkAnswer(ask({ kind: "text", accept: ["  ", ""] }), ""), false, "blank lines accept nothing");
  });

  test("numbers ignore commas and spaces but must be the right number", () => {
    for (const typed of ["1844", "1,844", " 1844 ", "1 844", "1844.00"]) assert.ok(Play.checkAnswer(number, typed), typed);
    for (const typed of ["1845", "184", "", "eighteen forty-four"]) assert.equal(Play.checkAnswer(number, typed), false, typed);
    assert.equal(Play.numberValue("12abc"), null);
    assert.equal(Play.numberValue("-3.5"), -3.5);
  });

  test("multiple choice accepts any option marked correct, by its id", () => {
    assert.ok(Play.checkAnswer(choice, "o2"));
    assert.ok(Play.checkAnswer(choice, "o3"));
    assert.equal(Play.checkAnswer(choice, "o1"), false);
    assert.equal(Play.checkAnswer(choice, "Pear"), false, "the option's text is not the answer");
  });

  test("a right answer is recorded, a wrong one changes nothing", () => {
    const p0 = Play.emptyProgress();
    const p1 = Play.solve(p0, text, " APPLE ");
    assert.equal(Play.isSolved(p1, text), true);
    assert.equal(p1.solved.q1, "APPLE", "what the team typed, for showing back");
    assert.equal(Play.solve(p0, text, "durian"), p0);
    assert.equal(Play.isSolved(p0, text), false);
    assert.equal(Play.solve(p0, choice, "o2").solved.q3, "Pear", "the option's text is shown back");
  });

  test("Next and Finish wait until the challenge is answered", () => {
    let p = Play.next(Play.activate(Play.emptyProgress(), "quiz"), withAnswers);   // on the first challenge
    assert.equal(Play.stage(withAnswers, p).index, 0);
    assert.equal(Play.canAdvance(withAnswers, p), false);
    assert.equal(Play.next(p, withAnswers), p, "Next does nothing while it's unanswered");
    p = Play.solve(p, text, "apple");
    assert.equal(Play.canAdvance(withAnswers, p), true);
    p = Play.next(p, withAnswers);
    assert.equal(Play.stage(withAnswers, p).index, 1);
    assert.equal(Play.back(p, withAnswers).at.quiz, 0, "Back is always allowed");

    p = Play.goTo(p, withAnswers, 2);                                   // the last challenge
    assert.equal(Play.canFinish(withAnswers, p), false);
    assert.equal(Play.finish(p, withAnswers), p);
    p = Play.solve(p, choice, "o2");
    assert.equal(Play.canFinish(withAnswers, p), true);
    assert.deepEqual(Play.finish(p, withAnswers).completed, ["quiz"]);
  });

  test("the starting challenge waits for its answer too", () => {
    const start = { name: "First", password: "opensesame", tasks: [text] };
    const g = { ...quizGame, start };
    let p = Play.unlockStart(Play.begin(g, Play.emptyProgress()));
    p = Play.next(p, Play.startAsLocation(start));
    assert.equal(Play.canFinishStart(start, p), false);
    p = Play.solve(p, text, "apple");
    assert.equal(Play.canFinishStart(start, p), true);
    assert.equal(Play.finishStart(p, start).start, "done");
  });

  test("a testing shortcut can step past an unanswered challenge", () => {
    const p = Play.markSolved(Play.emptyProgress(), text);
    assert.equal(Play.isSolved(p, text), true);
    assert.equal(Play.markSolved(p, t1), p, "nothing to mark when no answer is asked for");
  });

  test("answers given survive a reload, and drop with challenges the game no longer has", () => {
    const p = Play.reconcile({ solved: { q1: "apple", gone: "x", q2: 5 } }, quizGame);
    assert.deepEqual(p.solved, { q1: "apple" });
    // While the starting challenge is still sealed its answers can't be checked, so they're all kept.
    const sealed = Play.reconcile({ solved: { unknown: "kept" } }, { ...quizGame, start: { name: "s", sealed: "ctv1.x" } });
    assert.deepEqual(sealed.solved, { unknown: "kept" });
  });

  test("an answer must be complete before the game can be exported", () => {
    assert.deepEqual(Play.answerProblems(t1), []);
    assert.deepEqual(Play.answerProblems(ask({ kind: "text", accept: [] })), ["write the answer teams must give"]);
    assert.deepEqual(Play.answerProblems(ask({ kind: "text", accept: [" * "] })), ["an answer of only * would accept anything"]);
    assert.deepEqual(Play.answerProblems(ask({ kind: "number", accept: ["about 1844"] })), ['the answer "about 1844" isn\'t a number']);
    assert.deepEqual(Play.answerProblems(ask({ kind: "choice", options: [{ id: "o1", text: "One", correct: true }] })),
      ["a multiple choice question needs at least two options"]);
    assert.deepEqual(Play.answerProblems(ask({ kind: "choice", options: [{ id: "o1", text: "One" }, { id: "o2", text: " " }] })),
      ["one of the options is empty", "mark the correct option"]);
    assert.deepEqual(Play.answerProblems(ask({ kind: "riddle", accept: ["x"] })), ["the answer type isn't one this game knows"]);
    assert.deepEqual(Play.validateTask(ask({ kind: "number", accept: [] })), ["write the answer teams must give"]);
    assert.deepEqual(Play.validateGame({ ...quizGame, locations: [{ ...withAnswers, tasks: [ask({ kind: "number", accept: ["x"] })] }] })
      .filter(l => l.includes("challenge 1")), ['Quiz stop, challenge 1: the answer "x" isn\'t a number']);
  });
});
