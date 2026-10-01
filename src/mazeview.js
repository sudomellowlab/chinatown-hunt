/* ════════════════════════════════════════════════════════════════════
   MAZE VIEW
   Drawing a maze and letting a finger walk it. Used by the game itself
   (app.js, as part of a challenge) and by the single-maze file the admin
   file can export for someone to try.

   No imports and nothing of the game in it: give it a maze (see maze.js)
   and it hands back the elements, telling you when the walker comes out.
   ════════════════════════════════════════════════════════════════════ */
const MazeView = {
  NS: "http://www.w3.org/2000/svg",
  WALL: { N: 1, E: 2, S: 4, W: 8 },
  SIZE: 10,                       // a square, in the units the drawing is scaled from
  PAD: 0.6,
  LEAD_IN: "Start at the gold square and find your way out at the bottom.",
  LEAD_ON: "Keep going. The way out is at the bottom.",

  el(tag, props = {}){
    const node = document.createElementNS(MazeView.NS, tag);
    for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
    return node;
  },

  /* Build the maze.
       maze      what maze.js made
       solved    true to show it already done: the route lit up and its letters in order
       sentence  what to say once they are out
       onSolved  called with the trail (which is the route) when they come out at the bottom
     Returns { grid, says, redraw }: the drawing, the line underneath, and a way to redraw
     after the caller has changed its mind about `solved`. */
  draw(maze, { solved = false, sentence = "", onSolved = () => {} } = {}){
    const size = MazeView.SIZE, pad = MazeView.PAD, { WALL, el } = MazeView;
    const grid = el("svg", { id: "mazeGrid", role: "img", "aria-label": "Maze: trace the route with your finger",
      viewBox: `${-pad} ${-pad} ${maze.cols * size + pad * 2} ${maze.rows * size + pad * 2}` });
    const at = cell => ({ col: cell % maze.cols, row: Math.floor(cell / maze.cols) });
    const onRoute = new Set(maze.path);
    let done = !!solved;

    /* Where the walker has been: `trail` is the way back from the entrance (retreating out of a
       dead end rubs it out behind them), and `seen` is every square they've set foot on, whose
       letter stays on show. */
    let trail = done ? [...maze.path] : [];
    const seen = new Set(trail);
    const trailLayer = el("g", { id: "mazeTrail" });
    const letterLayer = el("g", { id: "mazeLetters" });
    grid.append(trailLayer, letterLayer);

    const lines = el("g", { class: "mazewalls" });
    for (let cell = 0; cell < maze.cols * maze.rows; cell++) {
      const { col, row } = at(cell), x = col * size, y = row * size, w = maze.walls[cell] ?? 0;
      const edge = (x1, y1, x2, y2) => lines.append(el("line", { x1, y1, x2, y2 }));
      if (w & WALL.N) edge(x, y, x + size, y);
      if (w & WALL.W) edge(x, y, x, y + size);
      if (row === maze.rows - 1 && (w & WALL.S)) edge(x, y + size, x + size, y + size);
      if (col === maze.cols - 1 && (w & WALL.E)) edge(x + size, y, x + size, y + size);
    }
    grid.append(lines);
    // The way in, marked, so nobody hunts for it. Kept as a reference: the maze isn't on the page yet.
    const first = at(maze.path[0]);
    const startMark = el("circle", { id: "mazeStart", cx: first.col * size + size / 2, cy: first.row * size + size / 2, r: size * 0.3 });
    grid.append(startMark);

    const says = document.createElement("p");
    says.id = "mazeSays";
    says.className = "mazesays";
    says.setAttribute("role", "status");

    function redraw(nowSolved = done){
      done = !!nowSolved;
      // The way back from the entrance, and the route itself once they're out.
      trailLayer.replaceChildren(...(done ? maze.path : trail).map(cell => {
        const { col, row } = at(cell);
        return el("rect", { class: done ? "route" : "", x: col * size + 0.8, y: row * size + 0.8,
          width: size - 1.6, height: size - 1.6, rx: 1.2 });
      }));
      /* Every square walked on keeps its letter — the wrong ones carry letters too. Once they're
         out, the route is drawn last and in order, so it reads as the sentence. */
      const show = done ? [...[...seen].filter(c => !onRoute.has(c)), ...maze.path] : [...seen];
      letterLayer.replaceChildren(...show.map(cell => {
        const { col, row } = at(cell);
        const t = el("text", { class: done && onRoute.has(cell) ? "route" : "",
          x: col * size + size / 2, y: row * size + size / 2, "text-anchor": "middle", "dominant-baseline": "central" });
        t.textContent = maze.grid?.[cell] ?? "";
        return t;
      }));
      startMark.toggleAttribute("hidden", seen.size > 0);
      says.textContent = done ? (String(sentence || "").trim() || maze.letters)
        : seen.size ? MazeView.LEAD_ON : MazeView.LEAD_IN;
      says.classList.toggle("done", done);
    }

    /* Dragging: the finger walks the maze. Any square it can reach from where it is — next door,
       with no wall between — is walked into, right way or wrong; dragging back the way it came
       retreats. Only coming out at the bottom finishes it, and that can only be done by the one
       route through, so the letters give nothing away until then. */
    const cellUnder = e => {
      const r = grid.getBoundingClientRect();
      if (!r.width || !r.height) return -1;
      const col = Math.floor(((e.clientX - r.left) / r.width) * maze.cols);
      const row = Math.floor(((e.clientY - r.top) / r.height) * maze.rows);
      return col >= 0 && col < maze.cols && row >= 0 && row < maze.rows ? row * maze.cols + col : -1;
    };
    const wallBetween = (from, to) => {
      const d = to - from, cols = maze.cols;
      const bit = d === -cols ? WALL.N : d === cols ? WALL.S
        : d === 1 && to % cols !== 0 ? WALL.E : d === -1 && from % cols !== 0 ? WALL.W : 0;
      return !bit || (maze.walls[from] & bit);
    };
    const reach = cell => {
      if (cell < 0 || done) return;
      if (!trail.length) {                          // they have to come in by the way in
        if (cell !== maze.path[0]) return;
        trail.push(cell);
      } else {
        const here = trail.at(-1);
        if (cell === here) return;
        if (wallBetween(here, cell)) return;        // a wall is a wall
        if (trail.length > 1 && cell === trail.at(-2)) trail.pop();   // back the way they came
        else if (trail.includes(cell)) return;      // their own trail: nowhere new to go
        else trail.push(cell);
      }
      seen.add(trail.at(-1));
      // Out at the bottom: in a maze with one way through, that trail is the route.
      if (trail.length === maze.path.length && trail.at(-1) === maze.path.at(-1)) {
        if (navigator.vibrate) { try { navigator.vibrate([30, 50, 30]); } catch(e){} }
        onSolved([...trail]);
        return;
      }
      redraw();
    };
    let tracing = false;
    grid.addEventListener("pointerdown", e => { tracing = true; grid.setPointerCapture?.(e.pointerId); reach(cellUnder(e)); e.preventDefault(); });
    grid.addEventListener("pointermove", e => { if (tracing) { reach(cellUnder(e)); e.preventDefault(); } });
    for (const end of ["pointerup", "pointercancel", "pointerleave"]) grid.addEventListener(end, () => { tracing = false; });

    redraw();
    return { grid, says, redraw };
  },
};

export { MazeView };
