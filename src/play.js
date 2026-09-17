/* ════════════════════════════════════════════════════════════════════
   GAME RULES
   Pure functions, no DOM, no imports. What a team sees at a location,
   which locations can open, and when the clues & suspects are revealed.
   The admin tools use the validators; the game uses the rest.

   Rules (these override SPEC.md):
   - Nothing is answered on this site: teams answer in LoQuiz. A challenge
     is text and an optional picture, nothing more.
   - A location shows its arrival text, then its challenges one at a time
     in order. Teams can go Back and Next; the last challenge has Finish.
   - Once a location opens, no other location can open until it's finished.
   - Reveal: from `revealMinutes` before the end of the team's own clock,
     or once every location is finished, no new location can open. A team
     part-way through a location finishes it; then the clues & suspects
     screen shows, and stays.

   Progress shape (persisted by the game):
     { active: locId|null, completed: [locId], at: { locId: index }, revealed: bool }
   `at` is the challenge a team is looking at; no entry means the arrival text.

   Challenges, clues and suspects may carry `image`: an https link to a
   picture on the organiser's server. Images are never embedded.
   ════════════════════════════════════════════════════════════════════ */
const Play = {
  DEFAULT_DURATION_MINUTES: 120,
  DEFAULT_REVEAL_MINUTES: 20,

  emptyProgress(){ return { active:null, completed:[], at:{}, revealed:false }; },

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
    if (progress.active || progress.revealed || progress.completed.includes(locId)) return progress;
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
  next(progress, location){
    const s = Play.stage(location, progress);
    return Play.goTo(progress, location, s.kind === "arrival" ? 0 : s.index + 1);
  },
  back(progress, location){
    const s = Play.stage(location, progress);
    return s.kind === "arrival" ? progress : Play.goTo(progress, location, s.index - 1);
  },
  // Finish is offered on the last challenge (or the arrival text of a location with none).
  canFinish(location, progress){
    const s = Play.stage(location, progress);
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
    const { active, completed, at, revealed } = { ...Play.emptyProgress(), ...progress };
    const p = { active, completed, at, revealed };
    const ids = new Set(game.locations.map(l => l.id));
    p.completed = (Array.isArray(p.completed) ? p.completed : []).filter(id => ids.has(id));
    if (!ids.has(p.active) || p.completed.includes(p.active)) p.active = null;
    const kept = {};
    for (const [id, i] of Object.entries(p.at && typeof p.at === "object" ? p.at : {}))
      if (ids.has(id) && Number.isInteger(i) && i >= 0) kept[id] = i;
    p.at = kept;
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
    return problems;
  },

  // Every problem in the game, as readable lines: "<location name>, challenge 2: mark the correct option".
  validateGame(game){
    const lines = [], seen = new Set(), locIds = new Set();
    if (!String(game.title ?? "").trim()) lines.push("Game: the title is empty");
    for (const p of Play.linkProblems(game.intro)) lines.push(`Game: start screen text: ${p}`);
    for (const p of Play.linkProblems(game.revealIntro)) lines.push(`Clues: introduction: ${p}`);
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
    return Play.newId("t", game.locations.flatMap(l => (l.tasks || []).map(t => t.id)), random);
  },
};

export { Play };
