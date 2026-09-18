/* ════════════════════════════════════════════════════════════════════
   GAME RULES
   Pure functions, no DOM, no imports. What a team sees at a location,
   which locations can open, and when the clues & suspects are revealed.
   The admin tools use the validators; the game uses the rest.

   Rules (these override SPEC.md):
   - Most challenges are answered in LoQuiz, not here: a challenge is text
     and an optional picture. A challenge may also carry an `answer`, and
     then the team must get it right on this site before moving on.
   - A location shows its arrival text, then its challenges one at a time
     in order. Teams can go Back and Next; the last challenge has Finish.
   - Once a location opens, no other location can open until it's finished.
   - An optional starting challenge (`game.start`) opens at Begin, with no
     location needed. It asks first for a password, which the LoQuiz host
     gives out; then its text and challenges show like a location's. Until
     it's finished, no location can open.
   - Reveal: from `revealMinutes` before the end of the team's own clock,
     or once every location is finished, no new location can open. A team
     part-way through a location finishes it; then the clues & suspects
     screen shows, and stays.

   Progress shape (persisted by the game):
     { active: locId|null, completed: [locId], at: { locId: index }, solved: { taskId: answer }, revealed: bool, start?: "locked"|"open"|"done" }
   `at` is the challenge a team is looking at; no entry means the arrival text.
   The starting challenge keeps its place in `at` under Play.START. `start` is
   absent for a game without one, and for a team that began before it was added.

   Challenges, clues and suspects may carry `image`: an https link to a
   picture on the organiser's server. Images are never embedded.
   ════════════════════════════════════════════════════════════════════ */
const Play = {
  DEFAULT_DURATION_MINUTES: 120,
  DEFAULT_REVEAL_MINUTES: 20,

  emptyProgress(){ return { active:null, completed:[], at:{}, solved:{}, revealed:false }; },

  /* ── answers ──
     A challenge may carry `answer`:
       { kind:"text",   accept:["apple", "*ple*"] }   patterns: * stands for anything
       { kind:"number", accept:["1844"] }             1,844 and " 1844 " match too
       { kind:"choice", options:[{ id, text, correct }] }
     Teams must get it right before Next (or Finish) will move them on. Without an
     `answer` a challenge behaves as before: read it here, answer it in LoQuiz. */
  ANSWER_KINDS: ["text", "number", "choice"],
  // Typed answers are compared ignoring capitals, leading/trailing space and doubled spaces.
  normalizeAnswer(text){ return String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase(); },
  answerOf(task){
    const a = task?.answer;
    return a && Play.ANSWER_KINDS.includes(a.kind) ? a : null;
  },
  needsAnswer(task){ return !!Play.answerOf(task); },
  // The accepted answers of a text or number challenge, blank lines dropped.
  accepted(answer){
    return (Array.isArray(answer?.accept) ? answer.accept : []).map(s => String(s ?? "").trim()).filter(Boolean);
  },
  choiceOptions(answer){ return Array.isArray(answer?.options) ? answer.options : []; },
  /* A text pattern: everything matches itself, except * which stands for any run of
     characters. "apple" is exact, "*ple*" is "contains ple", "ple*" starts, "*ple" ends. */
  matchesPattern(pattern, typed){
    const p = Play.normalizeAnswer(pattern);
    if (!p) return false;
    const rx = new RegExp("^" + p.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return rx.test(Play.normalizeAnswer(typed));
  },
  // A number as typed by a team or an organiser: spaces and thousands commas don't matter.
  numberValue(text){
    const s = Play.normalizeAnswer(text).replace(/[\s,]/g, "");
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
  },
  // Is this what the team typed (or the id of the option they tapped) right?
  checkAnswer(task, typed){
    const a = Play.answerOf(task);
    if (!a) return true;
    if (a.kind === "choice") return Play.choiceOptions(a).some(o => o.correct && o.id === typed);
    if (a.kind === "number") {
      const v = Play.numberValue(typed);
      return v != null && Play.accepted(a).some(x => Play.numberValue(x) === v);
    }
    return Play.accepted(a).some(x => Play.matchesPattern(x, typed));
  },
  solvedAnswer(progress, task){ return task ? progress.solved?.[task.id] : undefined; },
  isSolved(progress, task){ return !Play.needsAnswer(task) || Play.solvedAnswer(progress, task) !== undefined; },
  // Record a right answer. A wrong one leaves progress untouched, so nothing is stored for it.
  solve(progress, task, typed){
    if (!Play.needsAnswer(task) || !Play.checkAnswer(task, typed)) return progress;
    const a = Play.answerOf(task);
    const shown = a.kind === "choice"
      ? (Play.choiceOptions(a).find(o => o.id === typed)?.text ?? "")
      : String(typed ?? "").trim();
    return { ...progress, solved: { ...progress.solved, [task.id]: shown } };
  },
  // Dev shortcuts (admin file only) use this to step past a challenge that wants an answer.
  markSolved(progress, task){
    return Play.needsAnswer(task) && !Play.isSolved(progress, task)
      ? { ...progress, solved: { ...progress.solved, [task.id]: "(skipped in testing)" } } : progress;
  },
  /* May the team leave the challenge they are looking at? Only once it's answered,
     for a challenge that asks for an answer here. */
  canAdvance(location, progress){
    const s = Play.stage(location, progress);
    return s.kind !== "task" || Play.isSolved(progress, s.task);
  },

  /* ── the starting challenge ──
     game.start: { name, lockText, arrivalText, tasks, password } in the admin file; in an exported
     file { name, lockText, sealed }, the rest encrypted with the password (see admin.js).
     lockText is what the password screen says; empty means START_LOCK_TEXT. */
  START: "start",
  START_PASSWORD_MIN: 4,
  // Shown above the password box when the organiser hasn't written their own.
  START_LOCK_TEXT: "Your LoQuiz host will give you a password. Type it here to see your first challenge.",
  // The starting challenge as a location for stage/next/back/goTo: its place is kept in at[START].
  startAsLocation(start){ return { id: Play.START, name: start.name, arrivalText: start.arrivalText, tasks: start.tasks || [] }; },
  // Passwords are said aloud and typed on phones: ignore case and extra spaces.
  normalizePassword(text){ return String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase(); },
  // At Begin: a game with a starting challenge locks it until the password is given.
  begin(game, progress){
    return game.start && !progress.start ? { ...progress, start: "locked" } : progress;
  },
  // Until the starting challenge is finished, no location can open.
  startPending(progress){ return progress.start === "locked" || progress.start === "open"; },
  unlockStart(progress){ return progress.start === "locked" ? { ...progress, start: "open" } : progress; },
  canFinishStart(start, progress){
    if (progress.start !== "open") return false;
    const s = Play.stage(Play.startAsLocation(start), progress);
    if (s.kind === "task" && !Play.isSolved(progress, s.task)) return false;
    return s.kind === "task" ? s.last : s.total === 0;
  },
  finishStart(progress, start){
    return Play.canFinishStart(start, progress) ? { ...progress, start: "done" } : progress;
  },

  /* What the team should see at a location:
       arrival – the arrival text (before the first challenge, or after going Back from it)
       task    – challenge `index` of `total`; `last` when it's the one with Finish */
  stage(location, progress){
    const tasks = location.tasks || [];
    const at = progress.at?.[location.id];
    if (!Number.isInteger(at) || !tasks.length) return { kind: "arrival", total: tasks.length };
    const index = Math.max(0, Math.min(at, tasks.length - 1));   // a re-uploaded game may have fewer
    return { kind: "task", task: tasks[index], index, total: tasks.length, last: index === tasks.length - 1 };
  },

  /* ── transitions: each returns a new progress object ── */

  activate(progress, locId){
    if (progress.active || progress.revealed || Play.startPending(progress) || progress.completed.includes(locId)) return progress;
    return { ...progress, active: locId };
  },
  // Move to challenge `index`, or back to the arrival text with -1.
  goTo(progress, location, index){
    const n = (location.tasks || []).length;
    const at = { ...progress.at };
    if (index < 0 || !n) delete at[location.id];
    else at[location.id] = Math.min(index, n - 1);
    return { ...progress, at };
  },
  // Next refuses to move on from a challenge whose answer hasn't been given.
  next(progress, location){
    const s = Play.stage(location, progress);
    if (s.kind === "task" && !Play.isSolved(progress, s.task)) return progress;
    return Play.goTo(progress, location, s.kind === "arrival" ? 0 : s.index + 1);
  },
  back(progress, location){
    const s = Play.stage(location, progress);
    return s.kind === "arrival" ? progress : Play.goTo(progress, location, s.index - 1);
  },
  // Finish is offered on the last challenge (or the arrival text of a location with none).
  canFinish(location, progress){
    const s = Play.stage(location, progress);
    if (s.kind === "task" && !Play.isSolved(progress, s.task)) return false;
    return progress.active === location.id && (s.kind === "task" ? s.last : s.total === 0);
  },
  finish(progress, location){
    if (!Play.canFinish(location, progress)) return progress;
    const completed = progress.completed.includes(location.id) ? progress.completed : [...progress.completed, location.id];
    return { ...progress, active: null, completed };
  },

  /* ── the clues & suspects reveal ── */

  durationMs(game){ return (Number.isFinite(game.durationMinutes) ? game.durationMinutes : Play.DEFAULT_DURATION_MINUTES) * 60000; },
  revealMs(game){ return (Number.isFinite(game.revealMinutes) ? game.revealMinutes : Play.DEFAULT_REVEAL_MINUTES) * 60000; },

  // Has the reveal point been reached? msLeft is what remains on the team's clock (null before Begin).
  revealDue(game, progress, msLeft){
    if (progress.revealed) return true;
    if (game.locations.length && game.locations.every(l => progress.completed.includes(l.id))) return true;
    return msLeft != null && msLeft <= Play.revealMs(game);
  },
  /* Where the game is:
       play     – locations can open
       closing  – reveal is due, but the team is finishing its current location (or the starting challenge)
       reveal   – the clues & suspects screen */
  phase(game, progress, msLeft){
    if (progress.revealed) return "reveal";
    if (!Play.revealDue(game, progress, msLeft)) return "play";
    return progress.active || Play.startPending(progress) ? "closing" : "reveal";
  },
  // Mark the reveal as shown, once it's due and no location is in progress. It then stays.
  reveal(game, progress, msLeft){
    if (progress.revealed || Play.phase(game, progress, msLeft) !== "reveal") return progress;
    return { ...progress, revealed: true };
  },

  // Locations the geofence may open right now: only the active one while a location is in
  // progress, and none during the starting challenge or once the reveal is due.
  openable(locations, progress, revealDue = false){
    if (progress.active) return locations.filter(l => l.id === progress.active);
    if (revealDue || progress.revealed || Play.startPending(progress)) return [];
    return locations.filter(l => !progress.completed.includes(l.id));
  },

  // Bring stored progress into line with the game as it is now (a re-uploaded version, say).
  reconcile(progress, game){
    const { active, completed, at, solved, revealed, start } = { ...Play.emptyProgress(), ...progress };
    const p = { active, completed, at, solved, revealed };
    // A game re-uploaded without its starting challenge lets teams waiting on it carry on.
    if (game.start && ["locked", "open", "done"].includes(start)) p.start = start;
    const ids = new Set(game.locations.map(l => l.id));
    if (game.start) ids.add(Play.START);
    p.completed = (Array.isArray(p.completed) ? p.completed : []).filter(id => ids.has(id) && id !== Play.START);
    if (!ids.has(p.active) || p.active === Play.START || p.completed.includes(p.active)) p.active = null;
    const kept = {};
    for (const [id, i] of Object.entries(p.at && typeof p.at === "object" ? p.at : {}))
      if (ids.has(id) && Number.isInteger(i) && i >= 0) kept[id] = i;
    p.at = kept;
    /* Answers already given stay given, for every challenge the game still has. A challenge
       the team can't see yet (the sealed starting challenge) keeps its answer too, by id. */
    const taskIds = new Set([...(game.start?.tasks || []), ...game.locations.flatMap(l => l.tasks || [])].map(t => t.id));
    const solvedKept = {};
    for (const [id, given] of Object.entries(p.solved && typeof p.solved === "object" ? p.solved : {}))
      if ((taskIds.has(id) || (game.start?.sealed && !game.start.tasks)) && typeof given === "string") solvedKept[id] = given;
    p.solved = solvedKept;
    p.revealed = p.revealed === true;
    return p;
  },

  /* ── images ── */

  // Images are linked, never embedded: an https address on the organiser's own server.
  // Returns a problem in plain words, or null when the link is fine (an empty link is fine too).
  imageProblem(url){
    const s = String(url ?? "").trim();
    if (!s) return null;
    let u;
    try { u = new URL(s); } catch (e) { return "the image link isn't a web address"; }
    if (u.protocol === "http:") return "the image link must start with https:// (phones block http images)";
    if (u.protocol !== "https:") return "the image link must start with https://";
    return null;
  },
  // Every image link in the game, once each, in the order they appear.
  imageUrls(game){
    const urls = [
      ...(game.start?.tasks || []).map(t => t.image),
      ...game.locations.flatMap(l => (l.tasks || []).map(t => t.image)),
      ...(game.clues || []).map(c => c.image),
      ...(game.suspects || []).map(s => s.image),
    ].map(u => String(u ?? "").trim()).filter(u => u && !Play.imageProblem(u));
    return [...new Set(urls)];
  },

  /* ── links in text ── */

  // Organiser text may contain links written as [words](https://address).
  LINK: /\[([^\[\]\n]+)\]\(([^()\s]*)\)/g,
  linkProblem(href){
    let u;
    try { u = new URL(href); } catch (e) { return "isn't a web address"; }
    return ["https:", "http:"].includes(u.protocol) ? null : "must start with https://";
  },
  /* Split text into pieces: { text } or { text, href }. A link with a bad address stays plain text. */
  parseLinks(text){
    const s = String(text ?? ""), out = [];
    let last = 0;
    for (const m of s.matchAll(Play.LINK)) {
      if (Play.linkProblem(m[2])) continue;
      if (m.index > last) out.push({ text: s.slice(last, m.index) });
      out.push({ text: m[1], href: m[2] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  },
  // Problems with links in a piece of text, in plain words.
  linkProblems(text){
    return [...String(text ?? "").matchAll(Play.LINK)]
      .map(m => [m, Play.linkProblem(m[2])]).filter(([, p]) => p)
      .map(([m, p]) => `the link on "${m[1]}" ${p}`);
  },

  /* ── validation for the admin editor ── */

  validateTask(task){
    const problems = [];
    if (!String(task.prompt ?? "").trim() && !String(task.image ?? "").trim()) problems.push("add some text or a picture");
    const img = Play.imageProblem(task.image);
    if (img) problems.push(img);
    problems.push(...Play.linkProblems(task.prompt));
    problems.push(...Play.answerProblems(task));
    return problems;
  },

  // Problems with a challenge's answer, in plain words. No answer at all is fine.
  answerProblems(task){
    const a = task?.answer;
    if (a == null) return [];
    if (!Play.ANSWER_KINDS.includes(a.kind)) return ["the answer type isn't one this game knows"];
    if (a.kind === "choice") {
      const options = Play.choiceOptions(a);
      const problems = [];
      if (options.length < 2) problems.push("a multiple choice question needs at least two options");
      if (options.some(o => !String(o?.text ?? "").trim())) problems.push("one of the options is empty");
      if (!options.some(o => o.correct)) problems.push("mark the correct option");
      if (new Set(options.map(o => o.id)).size !== options.length) problems.push("two options share an id");
      return problems;
    }
    const accept = Play.accepted(a);
    if (!accept.length) return ["write the answer teams must give"];
    if (a.kind === "number") {
      const bad = accept.filter(x => Play.numberValue(x) == null);
      return bad.length ? [`the answer "${bad[0]}" isn't a number`] : [];
    }
    return accept.some(x => !x.replace(/\*/g, "").trim()) ? ["an answer of only * would accept anything"] : [];
  },

  // Every problem in the game, as readable lines: "<location name>, challenge 2: mark the correct option".
  validateGame(game){
    const lines = [], seen = new Set(), locIds = new Set();
    if (!String(game.title ?? "").trim()) lines.push("Game: the title is empty");
    for (const p of Play.linkProblems(game.intro)) lines.push(`Game: start screen text: ${p}`);
    for (const p of Play.linkProblems(game.revealIntro)) lines.push(`Clues: introduction: ${p}`);
    if (game.start) {
      const s = game.start, where = "Starting challenge";
      if (!String(s.name ?? "").trim()) lines.push(`${where}: give it a heading`);
      if (Play.normalizePassword(s.password).length < Play.START_PASSWORD_MIN)
        lines.push(`${where}: set a password of at least ${Play.START_PASSWORD_MIN} characters`);
      if (!(s.tasks || []).length) lines.push(`${where}: add at least one challenge`);
      for (const p of Play.linkProblems(s.lockText)) lines.push(`${where}: password screen text: ${p}`);
      for (const p of Play.linkProblems(s.arrivalText)) lines.push(`${where}: text: ${p}`);
      (s.tasks || []).forEach((t, i) => {
        if (!t.id) lines.push(`${where}, challenge ${i + 1}: missing id`);
        else if (seen.has(t.id)) lines.push(`${where}, challenge ${i + 1}: duplicate id ${t.id}`);
        seen.add(t.id);
        for (const p of Play.validateTask(t)) lines.push(`${where}, challenge ${i + 1}: ${p}`);
      });
    }
    if (!game.locations.length) lines.push("Locations: add at least one location");
    game.locations.forEach((l, i) => {
      const where = `Location ${i + 1}${String(l.name ?? "").trim() ? ` (${l.name})` : ""}`;
      if (!String(l.name ?? "").trim()) lines.push(`${where}: give it a name`);
      if (!l.id || locIds.has(l.id)) lines.push(`${where}: ${l.id ? "duplicate" : "missing"} id`);
      locIds.add(l.id);
      if (!(Number.isFinite(l.lat) && Math.abs(l.lat) <= 90 && Number.isFinite(l.lng) && Math.abs(l.lng) <= 180)) lines.push(`${where}: its position is invalid`);
      if (l.radius != null && !(Number.isFinite(l.radius) && l.radius > 0)) lines.push(`${where}: the radius must be more than 0`);
      for (const p of Play.linkProblems(l.arrivalText)) lines.push(`${where}: arrival text: ${p}`);
    });
    for (const l of game.locations) {
      (l.tasks || []).forEach((t, i) => {
        const where = `${l.name}, challenge ${i + 1}`;
        if (!t.id) lines.push(`${where}: missing id`);
        else if (seen.has(t.id)) lines.push(`${where}: duplicate id ${t.id}`);
        seen.add(t.id);
        for (const p of Play.validateTask(t)) lines.push(`${where}: ${p}`);
      });
    }
    const duration = game.durationMinutes, reveal = game.revealMinutes;
    if (!(Number.isInteger(duration) && duration > 0)) lines.push("Timing: the game length must be a whole number of minutes, more than 0");
    if (!(Number.isInteger(reveal) && reveal >= 0)) lines.push("Timing: the clues time must be a whole number of minutes, 0 or more");
    else if (Number.isInteger(duration) && reveal > duration) lines.push("Timing: the clues can't appear earlier than the start of the game");
    const clues = game.clues || [], suspects = game.suspects || [];
    if (!clues.length) lines.push("Clues: add at least one clue");
    clues.forEach((c, i) => {
      if (!String(c.text ?? "").trim()) lines.push(`Clues: clue ${i + 1} is empty`);
      const img = Play.imageProblem(c.image);
      if (img) lines.push(`Clues: clue ${i + 1}: ${img}`);
      for (const p of Play.linkProblems(c.text)) lines.push(`Clues: clue ${i + 1}: ${p}`);
    });
    if (!suspects.length) lines.push("Suspects: add at least one suspect");
    suspects.forEach((s, i) => {
      if (!String(s.name ?? "").trim()) lines.push(`Suspects: suspect ${i + 1} has no name`);
      const img = Play.imageProblem(s.image);
      if (img) lines.push(`Suspects: suspect ${i + 1}: ${img}`);
      for (const p of Play.linkProblems(s.blurb)) lines.push(`Suspects: suspect ${i + 1}: ${p}`);
    });
    return lines;
  },

  // A permanent id, unique among the ids given: "t-…" for challenges, "c-…" clues, "s-…" suspects.
  newId(prefix, taken, random = Math.random){
    const used = new Set(taken);
    let id;
    do { id = `${prefix}-` + Math.floor(random() * 36 ** 8).toString(36).padStart(8, "0"); } while (used.has(id));
    return id;
  },
  newLocationId(game, random = Math.random){
    return Play.newId("l", game.locations.map(l => l.id), random);
  },
  newTaskId(game, random = Math.random){
    return Play.newId("t", [...(game.start?.tasks || []), ...game.locations.flatMap(l => l.tasks || [])].map(t => t.id), random);
  },
};

export { Play };
