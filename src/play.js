/* ════════════════════════════════════════════════════════════════════
   GAME RULES
   Pure functions, no DOM, no imports. How challenges are answered and
   scored, what a team sees next at a location, and which locations can
   open. The admin tools use the validators; the game uses the rest.

   Rules (these override SPEC.md):
   - A location's challenges come strictly in order.
   - One attempt per challenge. Right: its points. Wrong: 0. No retry, no skip.
   - A hint costs its penalty off that challenge's points, never below 0.
   - Once a location opens, no other location can open until it's finished.

   Progress shape (persisted by the game):
     { active: locId|null, completed: [locId], answers: { taskId: { correct, points, hint } },
       hints: { taskId: true }, intro: { locId: true } }
   Answers are keyed by permanent task id, so a re-uploaded game keeps them.
   ════════════════════════════════════════════════════════════════════ */
const Play = {
  TYPES: ["multiple_choice", "text", "number"],
  DEFAULT_POINTS: 100,
  DEFAULT_HINT_PENALTY: 25,

  emptyProgress(){ return { active:null, completed:[], answers:{}, hints:{}, intro:{} }; },

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

  pointsFor(task){ return Number.isFinite(task.points) ? Math.max(0, task.points) : Play.DEFAULT_POINTS; },
  hintPenaltyFor(task){ return Number.isFinite(task.hintPenalty) ? Math.max(0, task.hintPenalty) : Play.DEFAULT_HINT_PENALTY; },

  // What this challenge is still worth, given whether its hint has been revealed.
  worth(task, hintUsed){ return Math.max(0, Play.pointsFor(task) - (hintUsed ? Play.hintPenaltyFor(task) : 0)); },

  // Next unanswered challenge at a location, in order, or null when all are answered.
  nextTask(location, progress){
    const tasks = location.tasks || [];
    const i = tasks.findIndex(t => !progress.answers[t.id]);
    return i < 0 ? null : { task: tasks[i], index: i, total: tasks.length };
  },

  /* What the team should see at their active location:
       arrival  – the arrival text, before the first challenge
       task     – the next challenge
       summary  – every challenge answered; score for this location */
  stage(location, progress){
    const tasks = location.tasks || [];
    const anyAnswered = tasks.some(t => progress.answers[t.id]);
    if (!progress.intro[location.id] && !anyAnswered) return { kind: "arrival" };
    const next = Play.nextTask(location, progress);
    if (next) return { kind: "task", ...next, hintShown: !!progress.hints[next.task.id] };
    return { kind: "summary", ...Play.locationScore(location, progress) };
  },

  locationScore(location, progress){
    let score = 0, max = 0, correct = 0;
    for (const t of location.tasks || []) {
      max += Play.pointsFor(t);
      const a = progress.answers[t.id];
      if (a) { score += a.points; if (a.correct) correct++; }
    }
    return { score, max, correct, total: (location.tasks || []).length };
  },

  // Every point ever earned, including for challenges since deleted from the game.
  totalScore(progress){
    return Object.values(progress.answers).reduce((sum, a) => sum + (a.points || 0), 0);
  },

  /* ── transitions: each returns a new progress object ── */

  activate(progress, locId){
    if (progress.active || progress.completed.includes(locId)) return progress;
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
  answer(progress, task, response){
    if (progress.answers[task.id]) return { progress, result: progress.answers[task.id], repeated: true };
    const hint = !!progress.hints[task.id];
    const correct = Play.isCorrect(task, response);
    const result = { correct, points: correct ? Play.worth(task, hint) : 0, hint };
    return { progress: { ...progress, answers: { ...progress.answers, [task.id]: result } }, result, repeated: false };
  },
  // Close the active location once all its challenges are answered.
  finish(progress, location){
    if (progress.active !== location.id || Play.nextTask(location, progress)) return progress;
    const completed = progress.completed.includes(location.id) ? progress.completed : [...progress.completed, location.id];
    return { ...progress, active: null, completed };
  },

  // Locations the geofence may open right now: none but the active one while a location is in progress.
  openable(locations, progress){
    if (progress.active) return locations.filter(l => l.id === progress.active);
    return locations.filter(l => !progress.completed.includes(l.id));
  },

  // Bring stored progress into line with the game as it is now (a re-uploaded version, say).
  reconcile(progress, game){
    const p = { ...Play.emptyProgress(), ...progress };
    const ids = new Set(game.locations.map(l => l.id));
    p.completed = (Array.isArray(p.completed) ? p.completed : []).filter(id => ids.has(id));
    if (!ids.has(p.active) || p.completed.includes(p.active)) p.active = null;
    for (const k of ["answers", "hints", "intro"]) if (!p[k] || typeof p[k] !== "object") p[k] = {};
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
    if (task.points != null && !(Number.isFinite(task.points) && task.points >= 0)) problems.push("points must be 0 or more");
    if (task.hintPenalty != null && !(Number.isFinite(task.hintPenalty) && task.hintPenalty >= 0)) problems.push("the hint cost must be 0 or more");
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
    return lines;
  },

  // A permanent id for a new challenge, unique within the game.
  newTaskId(game, random = Math.random){
    const taken = new Set(game.locations.flatMap(l => (l.tasks || []).map(t => t.id)));
    let id;
    do { id = "t-" + Math.floor(random() * 36 ** 8).toString(36).padStart(8, "0"); } while (taken.has(id));
    return id;
  },
};

export { Play };
