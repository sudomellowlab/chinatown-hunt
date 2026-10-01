/* ════════════════════════════════════════════════════════════════════
   MAZE
   Builds a maze whose one route through spells a sentence, a letter per
   square. Teams trace the route with a finger and the letters appear.

   Pure functions, no DOM, no imports. The admin file builds a maze once
   and keeps it with the challenge; the game only draws what it's given.

   A maze is { cols, rows, walls, path, letters, sentence }:
     walls    one number per square, bits 1 N, 2 E, 4 S, 8 W; a bit set
              means a wall on that side. Neighbours always agree.
     path     the squares of the route in order, as cols*row + col.
     letters  the sentence's letters, one per square of the path.
   ════════════════════════════════════════════════════════════════════ */
const Maze = {
  N: 1, E: 2, S: 4, W: 8,
  MIN_LETTERS: 4,
  MAX_COLS: 9,           // on a phone, more columns than this makes the squares too small to hit
  FILL: 0.6,             // how much of the grid the route takes up; the rest becomes dead ends

  /* The same sentence always gives the same maze: the numbers come from the sentence itself,
     not from chance, so a maze never changes under anyone. `attempt` is how "Try another" asks
     for a different one, and is kept with the maze so that one is repeatable too. */
  seed(sentence, attempt = 0){
    let h = 0x811c9dc5;
    for (const ch of `${attempt}:${String(sentence ?? "")}`) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
    return h || 1;
  },
  numbers(sentence, attempt = 0){
    let s = Maze.seed(sentence, attempt);
    return () => {                                       // mulberry32
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // The squares a sentence needs: its letters and digits, without spaces or punctuation.
  letters(sentence){ return [...String(sentence ?? "")].filter(c => /[\p{L}\p{N}]/u.test(c)); },

  // Which way from one square to the next, as a wall bit.
  step(from, to, cols){
    const d = to - from;
    if (d === -cols) return Maze.N;
    if (d === cols) return Maze.S;
    if (d === 1 && to % cols !== 0) return Maze.E;
    if (d === -1 && from % cols !== 0) return Maze.W;
    return 0;
  },
  opposite(bit){ return { [Maze.N]: Maze.S, [Maze.S]: Maze.N, [Maze.E]: Maze.W, [Maze.W]: Maze.E }[bit]; },
  neighbours(cell, cols, rows){
    const out = [];
    for (const to of [cell - cols, cell + 1, cell + cols, cell - 1])
      if (to >= 0 && to < cols * rows && Maze.step(cell, to, cols)) out.push(to);
    return out;
  },

  // A grid that fits the route with room to spare for dead ends.
  shape(count){
    const cols = Math.max(5, Math.min(Maze.MAX_COLS, Math.ceil(Math.sqrt(count / Maze.FILL))));
    const rows = Math.max(5, Math.ceil(count / (cols * Maze.FILL)));
    return { cols, rows };
  },

  /* The route: a walk of exactly `count` squares that never crosses itself, found by trying
     ways on and stepping back when stuck. Returns null if this grid can't hold one. */
  route(cols, rows, count, random, budget = 200000){
    const start = 0;
    const path = [start], taken = new Set([start]), tried = [new Set()];
    let steps = 0;
    while (path.length < count) {
      if (++steps > budget) return null;
      const cell = path.at(-1);
      const open = Maze.neighbours(cell, cols, rows).filter(n => !taken.has(n) && !tried.at(-1).has(n));
      if (!open.length) {                                  // stuck: step back and try another way
        if (path.length === 1) return null;
        taken.delete(path.pop());
        tried.pop();
        tried.at(-1).add(cell);
        continue;
      }
      const next = open[Math.floor(random() * open.length)];
      tried.at(-1).add(next);
      path.push(next); taken.add(next); tried.push(new Set());
    }
    return path;
  },

  /* Carve the maze: every square joins one tree, so there is exactly one way between any two
     squares — and since the route is part of that tree, it is the only way through. */
  carve(cols, rows, path, random){
    const walls = Array.from({ length: cols * rows }, () => Maze.N | Maze.E | Maze.S | Maze.W);
    const open = (a, b) => {
      const bit = Maze.step(a, b, cols);
      walls[a] &= ~bit;
      walls[b] &= ~Maze.opposite(bit);
    };
    const inTree = new Set(path);
    for (let i = 1; i < path.length; i++) open(path[i - 1], path[i]);
    // Everything not on the route hangs off it as dead ends (randomised Prim's).
    const frontier = [];
    const offer = cell => {
      for (const n of Maze.neighbours(cell, cols, rows)) if (!inTree.has(n)) frontier.push([cell, n]);
    };
    for (const cell of path) offer(cell);
    while (frontier.length) {
      const pick = Math.floor(random() * frontier.length);
      const [from, to] = frontier.splice(pick, 1)[0];
      if (inTree.has(to)) continue;
      open(from, to);
      inTree.add(to);
      offer(to);
    }
    return walls;
  },

  /* Build a maze for a sentence. The same sentence and attempt always give the same maze.
     Throws, in plain words, when the sentence won't do. */
  build(sentence, attempt = 0){
    const letters = Maze.letters(sentence);
    if (letters.length < Maze.MIN_LETTERS) throw new Error(`write a sentence with at least ${Maze.MIN_LETTERS} letters`);
    const random = Maze.numbers(sentence, attempt);
    let { cols, rows } = Maze.shape(letters.length);
    for (let roomier = 0; roomier < 24; roomier++) {
      const path = Maze.route(cols, rows, letters.length, random);
      if (path) return { cols, rows, walls: Maze.carve(cols, rows, path, random), path,
        letters: letters.join(""), sentence: String(sentence).trim(), attempt };
      rows += 1;                                           // give it another row and try again
    }
    throw new Error("couldn't lay a route for that sentence; try a shorter one");
  },

  // Is this a maze the game can draw and trace? Returns a problem in plain words, or null.
  problem(maze){
    if (!maze || typeof maze !== "object") return "the maze is missing";
    const { cols, rows, walls, path, letters } = maze;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return "the maze has no size";
    if (!Array.isArray(walls) || walls.length !== cols * rows) return "the maze's walls don't fit its size";
    if (!Array.isArray(path) || !path.length) return "the maze has no route through it";
    if (typeof letters !== "string" || letters.length !== path.length) return "the maze's letters don't fit its route";
    for (let i = 0; i < path.length; i++) {
      const cell = path[i];
      if (!Number.isInteger(cell) || cell < 0 || cell >= cols * rows) return `square ${i + 1} of the route is outside the maze`;
      if (i && !Maze.step(path[i - 1], cell, cols)) return `the route jumps between squares ${i} and ${i + 1}`;
      if (i && (walls[path[i - 1]] & Maze.step(path[i - 1], cell, cols))) return `a wall blocks the route between squares ${i} and ${i + 1}`;
    }
    if (new Set(path).size !== path.length) return "the route crosses itself";
    return null;
  },
};

export { Maze };
