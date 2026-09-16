/* ════════════════════════════════════════════════════════════════════
   GAME RULES
   Pure functions, no DOM, no imports. How challenges are answered, what
   a team sees next at a location, which locations can open, and when the
   clues & suspects are revealed. The admin tools use the validators; the
   game uses the rest.

   Rules (these override SPEC.md):
   - A location's challenges come strictly in order.
   - One attempt per challenge. No retry, no skip.
   - No points on this site (scoring happens in LoQuiz): after answering,
     nothing is shown; the next challenge appears. Hints are free.
   - Once a location opens, no other location can open until it's finished.
   - Reveal: from `revealMinutes` before the end of the team's own clock,
     or once every location is finished, no new location can open. A team
     part-way through a location finishes it; then the clues & suspects
     screen shows, and stays.

   Progress shape (persisted by the game):
     { active: locId|null, completed: [locId], answers: { taskId: { correct, hint, at } },
       hints: { taskId: true }, intro: { locId: true }, revealed: bool }
   Answers are keyed by permanent task id, so a re-uploaded game keeps them.
   `correct` is recorded but never shown to the team.
   ════════════════════════════════════════════════════════════════════ */
const Play = {
  TYPES: ["multiple_choice", "text", "number"],
  DEFAULT_DURATION_MINUTES: 120,
  DEFAULT_REVEAL_MINUTES: 20,

  emptyProgress(){ return { active:null, completed:[], answers:{}, hints:{}, intro:{}, revealed:false }; },

  // Lowercase, strip punctuation and symbols, collapse whitespace. Letters in any script survive.
  normalize(text){
    return String(text ?? "").normalize("NFKC").toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
  },

  // "1,839", " 1839 ", "1 839" → 1839. Returns NaN for anything that isn't a number.
  parseNumber(text){
    const s = String(text ?? "").trim().replace(/[\s,_]/g, "");
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
  },

  isCorrect(task, response){
    switch (task.type) {
      case "multiple_choice": return Number.isInteger(response) && response === task.answer;
      case "text": {
        const r = Play.normalize(response);
        return r !== "" && (task.accept || []).some(a => Play.normalize(a) === r);
      }
      case "number": {
        const n = Play.parseNumber(response);
        return Number.isFinite(n) && Math.abs(n - Number(task.answer)) <= Math.abs(Number(task.tolerance) || 0) + 1e-9;
      }
      default: return false;
    }
  },

  // Next unanswered challenge at a location, in order, or null when all are answered.
  nextTask(location, progress){
    const tasks = location.tasks || [];
    const i = tasks.findIndex(t => !progress.answers[t.id]);
    return i < 0 ? null : { task: tasks[i], index: i, total: tasks.length };
  },

  /* What the team should see at their active location:
       arrival  – the arrival text, before the first challenge
       task     – the next challenge
       summary  – every challenge answered */
  stage(location, progress){
    const tasks = location.tasks || [];
    const anyAnswered = tasks.some(t => progress.answers[t.id]);
    if (!progress.intro[location.id] && !anyAnswered) return { kind: "arrival" };
    const next = Play.nextTask(location, progress);
    if (next) return { kind: "task", ...next, hintShown: !!progress.hints[next.task.id] };
    return { kind: "summary", total: tasks.length };
  },

  /* ── transitions: each returns a new progress object ── */

  activate(progress, locId){
    if (progress.active || progress.revealed || progress.completed.includes(locId)) return progress;
    return { ...progress, active: locId };
  },
  startChallenges(progress, locId){
    return { ...progress, intro: { ...progress.intro, [locId]: true } };
  },
  revealHint(progress, taskId){
    if (progress.answers[taskId]) return progress;
    return { ...progress, hints: { ...progress.hints, [taskId]: true } };
  },
  // One attempt: an already-answered challenge keeps its first answer.
  answer(progress, task, response, at = null){
    if (progress.answers[task.id]) return { progress, repeated: true };
    const result = { correct: Play.isCorrect(task, response), hint: !!progress.hints[task.id], at };
    return { progress: { ...progress, answers: { ...progress.answers, [task.id]: result } }, repeated: false };
  },
  // Close the active location once all its challenges are answered.
  finish(progress, location){
    if (progress.active !== location.id || Play.nextTask(location, progress)) return progress;
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
       closing  – reveal is due, but the team is finishing its current location
       reveal   – the clues & suspects screen */
  phase(game, progress, msLeft){
    if (progress.revealed) return "reveal";
    if (!Play.revealDue(game, progress, msLeft)) return "play";
    return progress.active ? "closing" : "reveal";
  },
  // Mark the reveal as shown, once it's due and no location is in progress. It then stays.
  reveal(game, progress, msLeft){
    if (progress.revealed || Play.phase(game, progress, msLeft) !== "reveal") return progress;
    return { ...progress, revealed: true };
  },

  // Locations the geofence may open right now: only the active one while a location is in
  // progress, and none once the reveal is due.
  openable(locations, progress, revealDue = false){
    if (progress.active) return locations.filter(l => l.id === progress.active);
    if (revealDue || progress.revealed) return [];
    return locations.filter(l => !progress.completed.includes(l.id));
  },

  // Bring stored progress into line with the game as it is now (a re-uploaded version, say).
  reconcile(progress, game){
    const p = { ...Play.emptyProgress(), ...progress };
    const ids = new Set(game.locations.map(l => l.id));
    p.completed = (Array.isArray(p.completed) ? p.completed : []).filter(id => ids.has(id));
    if (!ids.has(p.active) || p.completed.includes(p.active)) p.active = null;
    for (const k of ["answers", "hints", "intro"]) if (!p[k] || typeof p[k] !== "object") p[k] = {};
    p.revealed = p.revealed === true;
    return p;
  },

  /* ── validation for the admin editor ── */

  validateTask(task){
    const problems = [];
    if (!Play.TYPES.includes(task.type)) problems.push("choose a challenge type");
    if (!String(task.prompt ?? "").trim()) problems.push("the question is empty");
    if (task.type === "multiple_choice") {
      const opts = (task.options || []).map(o => String(o ?? "").trim());
      if (opts.filter(Boolean).length < 2) problems.push("needs at least two options");
      if (opts.some(o => !o)) problems.push("an option is empty");
      if (!Number.isInteger(task.answer) || task.answer < 0 || task.answer >= opts.length) problems.push("mark the correct option");
    }
    if (task.type === "text" && !(task.accept || []).some(a => Play.normalize(a))) problems.push("add at least one accepted answer");
    if (task.type === "number") {
      if (!Number.isFinite(Number(task.answer)) || task.answer === "" || task.answer == null) problems.push("the answer must be a number");
      if (task.tolerance != null && task.tolerance !== "" && !(Number(task.tolerance) >= 0)) problems.push("the tolerance must be 0 or more");
    }
    return problems;
  },

  // Every problem in the game, as readable lines: "<location name>, challenge 2: mark the correct option".
  validateGame(game){
    const lines = [], seen = new Set();
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
    clues.forEach((c, i) => { if (!String(c.text ?? "").trim()) lines.push(`Clues: clue ${i + 1} is empty`); });
    if (!suspects.length) lines.push("Suspects: add at least one suspect");
    suspects.forEach((s, i) => { if (!String(s.name ?? "").trim()) lines.push(`Suspects: suspect ${i + 1} has no name`); });
    return lines;
  },

  // A permanent id, unique among the ids given: "t-…" for challenges, "c-…" clues, "s-…" suspects.
  newId(prefix, taken, random = Math.random){
    const used = new Set(taken);
    let id;
    do { id = `${prefix}-` + Math.floor(random() * 36 ** 8).toString(36).padStart(8, "0"); } while (used.has(id));
    return id;
  },
  newTaskId(game, random = Math.random){
    return Play.newId("t", game.locations.flatMap(l => (l.tasks || []).map(t => t.id)), random);
  },
};

export { Play };
