import { Play } from "./play.js";

/* ════════════════════════════════════════════════════════════════════
   LOQUIZ SYNC RULES — pure, no DOM. Only the hosted participant file
   follows LoQuiz (sync.js does the talking); the admin file just keeps
   the links with the game.

   The organiser links LoQuiz questions to the game in three places:
     start.loquizUnlock      answering it opens the starting challenge — its
                             answer is the password, so it can unseal it
     location.loquizOpen     answering it opens that location, as if the team
                             had walked into it (GPS still opens it as before)
     task.loquiz             answering it moves the team past that challenge:
                             on to the next one, or the location is finished
   Each link is { taskId, correctOnly }; with correctOnly a wrong answer
   does nothing. LoQuiz is the team's own record of where it is, so what it
   says wins: a challenge answered there counts as answered here, and
   opening a location finishes the one the phone was still showing. A team
   never goes backwards.
   ════════════════════════════════════════════════════════════════════ */
const LoQuiz = {
  ANSWERED: "Answered in LoQuiz",

  // A list of links, keeping only real ones.
  links(list){
    return (Array.isArray(list) ? list : [])
      .filter(l => l && typeof l.taskId === "string" && l.taskId.trim())
      .map(l => ({ taskId: l.taskId.trim(), correctOnly: l.correctOnly !== false }));
  },
  linked(item, field = "loquiz"){ return LoQuiz.links(item?.[field]).length > 0; },
  // Does this answer count for this link?
  counts(link, answer){ return !link.correctOnly || !!answer?.correct; },

  /* Everything one LoQuiz question is linked to, in game order:
       { kind:"unlock" } | { kind:"open", locId } | { kind:"task", locId, index }
     A starting challenge still sealed (not unlocked on this phone) has no challenges to find. */
  hits(game, taskId){
    const out = [];
    const add = (list, hit) => { for (const link of LoQuiz.links(list)) if (link.taskId === taskId) out.push({ ...hit, link }); };
    if (game.start) {
      add(game.start.loquizUnlock, { kind: "unlock" });
      (Array.isArray(game.start.tasks) ? game.start.tasks : []).forEach((t, index) => add(t.loquiz, { kind: "task", locId: Play.START, index }));
    }
    for (const l of game.locations || []) {
      add(l.loquizOpen, { kind: "open", locId: l.id });
      (l.tasks || []).forEach((t, index) => add(t.loquiz, { kind: "task", locId: l.id, index }));
    }
    return out;
  },

  // Open a location because LoQuiz has moved on to it. Returns the same progress if there's nothing to do.
  open(progress, game, locId){
    const l = (game.locations || []).find(x => x.id === locId);
    if (!l || progress.revealed || progress.active === locId || progress.completed.includes(locId)) return progress;
    let p = progress;
    // LoQuiz is past the starting challenge, and past whatever location this phone was still showing.
    if (Play.startPending(p)) p = { ...p, start: "done" };
    if (p.active) p = { ...p, active: null, completed: [...p.completed, p.active] };
    return { ...p, active: locId };
  },

  /* Move past challenge `index` of a location (or of the starting challenge, Play.START), because
     its LoQuiz question was answered. Earlier challenges count as answered too; the last one
     finishes the location (or the starting challenge). Never moves a team backwards. */
  pass(progress, game, locId, index){
    const isStart = locId === Play.START;
    const loc = isStart ? (game.start && Play.startAsLocation(game.start)) : (game.locations || []).find(l => l.id === locId);
    if (!loc || progress.revealed) return progress;
    const tasks = loc.tasks || [];
    if (!tasks[index]) return progress;
    let p = progress;
    if (isStart) {
      if (p.start !== "open") return p;               // still locked (or already done): nothing to move
    } else {
      if (p.completed.includes(locId)) return p;
      if (p.active !== locId) p = LoQuiz.open(p, game, locId);
      if (p.active !== locId) return progress;
    }
    const at = p.at?.[locId];
    if (Number.isInteger(at) && at > index) return p === progress ? progress : p;   // already further on
    const solved = { ...p.solved };
    for (const t of tasks.slice(0, index + 1)) if (Play.mustFinish(t) && solved[t.id] === undefined) solved[t.id] = LoQuiz.ANSWERED;
    p = { ...p, solved };
    if (index === tasks.length - 1) {
      return isStart ? { ...p, start: "done" } : { ...p, active: null, completed: [...p.completed, locId] };
    }
    return Play.goTo(p, loc, index + 1);
  },
};

export { LoQuiz };
