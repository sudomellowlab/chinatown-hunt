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
     grid     a letter for every square: the sentence's along the route, and decoys everywhere
              else, so that a letter appearing tells a team nothing about being on the route.
   ════════════════════════════════════════════════════════════════════ */
const Maze = {
  N: 1, E: 2, S: 4, W: 8,
  MIN_LETTERS: 4,
  MAX_COLS: 9,           // on a phone, more columns than this makes the squares too small to hit
  MAX_ROWS: 15,          // and more rows than this makes the maze taller than a phone screen
  /* How much of the grid the route takes up. The rest becomes false corridors, so the less the
     route fills, the more there is to go wrong: that is what makes a maze hard. */
  LEVELS: { easy: 0.68, fair: 0.55, hard: 0.44 },
  DEFAULT_LEVEL: "hard",
  fill(level){ return Maze.LEVELS[level] ?? Maze.LEVELS[Maze.DEFAULT_LEVEL]; },
  /* The most letters a maze can hold: the biggest grid that fits a phone, with room left for
     the route to wind rather than fill nearly every square (past about this many, a route
     can't reliably be laid at all, and the squares would be too small to trace anyway). */
  MAX_LETTERS: 80,

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

  /* A grid that fits the route with room to spare for false corridors. Never more rows than
     there are letters (the route has to reach from the top row to the bottom one), and never
     more than will fit on a phone. */
  shape(count, level){
    const fill = Maze.fill(level);
    const cols = Math.max(3, Math.min(Maze.MAX_COLS, Math.ceil(Math.sqrt(count / fill))));
    const rows = Math.max(3, Math.min(count, Maze.MAX_ROWS, Math.ceil(count / (cols * fill))));
    return { cols, rows };
  },

  /* The route: a walk of exactly `count` squares, in at the top and out at the bottom, that
     never crosses itself. Found by trying ways on and stepping back when stuck, so the walk
     ends where it has to rather than wherever it happens to run out.
     Returns null if this grid can't hold one within the budget. */
  route(cols, rows, count, random, start = 0, budget = 400000){
    const out = cell => cell >= cols * (rows - 1);         // the bottom row is the way out
    const path = [start], taken = new Set([start]), tried = [new Set()];
    let steps = 0;
    while (path.length < count || !out(path.at(-1))) {
      if (++steps > budget) return null;
      const cell = path.at(-1);
      const open = path.length < count
        ? Maze.neighbours(cell, cols, rows).filter(n => !taken.has(n) && !tried.at(-1).has(n))
        : [];                                              // long enough but not out yet: step back
      if (!open.length) {
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
    /* Everything not on the route becomes false corridors hanging off it. They are carved
       depth-first, so each one wanders a long way before dying: a wrong turn looks as
       promising as the right one for quite a while. (Taking the nearest square instead, as
       Prim's does, leaves short stubs that give the game away at a glance.) */
    const starts = [...path].reverse();                    // from the far end first, so corridors reach back
    for (const from of starts) {
      for (const first of Maze.neighbours(from, cols, rows)) {
        if (inTree.has(first)) continue;
        open(from, first);
        inTree.add(first);
        const stack = [first];
        while (stack.length) {
          const cell = stack.at(-1);
          const open_ = Maze.neighbours(cell, cols, rows).filter(n => !inTree.has(n));
          if (!open_.length) { stack.pop(); continue; }
          const next = open_[Math.floor(random() * open_.length)];
          open(cell, next);
          inTree.add(next);
          stack.push(next);
        }
      }
    }
    return walls;
  },

  /* Build a maze for a sentence. The same sentence and attempt always give the same maze.
     Throws, in plain words, when the sentence won't do. */
  build(sentence, attempt = 0, level = Maze.DEFAULT_LEVEL){
    const letters = Maze.letters(sentence);
    if (letters.length < Maze.MIN_LETTERS) throw new Error(`write a sentence with at least ${Maze.MIN_LETTERS} letters`);
    if (letters.length > Maze.MAX_LETTERS)
      throw new Error(`that sentence has ${letters.length} letters: a maze that fits a phone holds about ${Maze.MAX_LETTERS}`);
    const random = Maze.numbers(`${level}|${sentence}`, attempt);
    let { cols, rows } = Maze.shape(letters.length, level);
    for (let roomier = 0; roomier < 24; roomier++) {
      /* In from somewhere along the top. A walk that fills this much of the grid can paint
         itself into a corner, so several ways in are tried before the grid is made roomier. */
      for (let go = 0; go < 12; go++) {
        const start = Math.floor(random() * cols);
        const path = Maze.route(cols, rows, letters.length, random, start);
        if (!path) continue;
        const walls = Maze.carve(cols, rows, path, random);
        walls[path[0]] &= ~Maze.N;                         // the way in
        walls[path.at(-1)] &= ~Maze.S;                     // and the way out
        return { cols, rows, walls, path, letters: letters.join(""),
          grid: Maze.fill_grid(cols, rows, path, letters, random),
          sentence: String(sentence).trim(), attempt,
          level: level in Maze.LEVELS ? level : Maze.DEFAULT_LEVEL };
      }
      // No way through this grid: make it roomier, but never taller than a phone will show.
      if (rows + 1 <= Math.min(letters.length, Maze.MAX_ROWS)) rows += 1;
      else if (cols < Maze.MAX_COLS) cols += 1;
      else break;
    }
    throw new Error("couldn't lay a route for that sentence; try a shorter one");
  },

  /* A letter for every square. The route carries the sentence; every other square carries a
     decoy drawn from the same sentence, so the wrong ways look exactly like the right one.
     Decoys avoid repeating the route's letter where that would give a square away. */
  fill_grid(cols, rows, path, letters, random){
    const pool = [...new Set(letters)].filter(c => /\S/.test(c));
    const grid = new Array(cols * rows).fill("");
    path.forEach((cell, i) => { grid[cell] = letters[i]; });
    for (let cell = 0; cell < cols * rows; cell++)
      if (!grid[cell]) grid[cell] = pool[Math.floor(random() * pool.length)] ?? "?";
    return grid.join("");
  },

  // Is this a maze the game can draw and trace? Returns a problem in plain words, or null.
  problem(maze){
    if (!maze || typeof maze !== "object") return "the maze is missing";
    const { cols, rows, walls, path, letters } = maze;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return "the maze has no size";
    if (!Array.isArray(walls) || walls.length !== cols * rows) return "the maze's walls don't fit its size";
    if (!Array.isArray(path) || !path.length) return "the maze has no route through it";
    if (typeof letters !== "string" || letters.length !== path.length) return "the maze's letters don't fit its route";
    const grid = maze.grid;
    if (typeof grid !== "string" || grid.length !== cols * rows) return "the maze's squares don't all have a letter";
    for (let i = 0; i < path.length; i++) {
      const cell = path[i];
      if (!Number.isInteger(cell) || cell < 0 || cell >= cols * rows) return `square ${i + 1} of the route is outside the maze`;
      if (i && !Maze.step(path[i - 1], cell, cols)) return `the route jumps between squares ${i} and ${i + 1}`;
      if (i && (walls[path[i - 1]] & Maze.step(path[i - 1], cell, cols))) return `a wall blocks the route between squares ${i} and ${i + 1}`;
    }
    if (new Set(path).size !== path.length) return "the route crosses itself";
    // Checked last, once the route's squares are known to be real ones.
    for (let i = 0; i < path.length; i++)
      if (grid[path[i]] !== letters[i]) return `square ${i + 1} of the route carries the wrong letter`;
    return null;
  },
};

export { Maze };
