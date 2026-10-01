// The maze a sentence turns into: one route through, a letter per square. Run with: node --test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Maze } from "../src/maze.js";

const SENTENCE = "Sang Nila Utama reigned over it and was given the name of Seri Teri Buana.";

// Every square reachable from the first one, walking only where there is no wall.
function reachable(maze){
  const seen = new Set([maze.path[0]]), queue = [maze.path[0]];
  while (queue.length) {
    const cell = queue.shift();
    for (const n of Maze.neighbours(cell, maze.cols, maze.rows)) {
      if (maze.walls[cell] & Maze.step(cell, n, maze.cols)) continue;
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen;
}
// The ways out of each square, counted; a maze with one route has no loops, so passages = cells - 1.
function passages(maze){
  let open = 0;
  for (let cell = 0; cell < maze.cols * maze.rows; cell++)
    for (const n of Maze.neighbours(cell, maze.cols, maze.rows))
      if (!(maze.walls[cell] & Maze.step(cell, n, maze.cols))) open++;
  return open / 2;
}

describe("building a maze from a sentence", () => {
  const maze = Maze.build(SENTENCE);

  test("one square per letter, spaces and punctuation left out", () => {
    assert.equal(maze.letters, "SangNilaUtamareignedoveritandwasgiventhenameofSeriTeriBuana");
    assert.equal(maze.path.length, maze.letters.length);
    assert.equal(maze.sentence, SENTENCE);
  });

  test("the maze is sound: the route fits, never crosses itself, and no wall blocks it", () => {
    assert.equal(Maze.problem(maze), null);
  });

  test("the grid is phone-sized and holds the route with room for dead ends", () => {
    assert.ok(maze.cols <= Maze.MAX_COLS, `${maze.cols} columns`);
    assert.ok(maze.cols * maze.rows > maze.path.length, "there are squares off the route");
    assert.ok(maze.cols * maze.rows < maze.path.length * 3, "and not a wilderness of them");
  });

  test("every square can be walked to, and there are no loops: one way through, the route", () => {
    assert.equal(reachable(maze).size, maze.cols * maze.rows, "every square is reachable");
    assert.equal(passages(maze), maze.cols * maze.rows - 1, "no loops: it's a tree");
  });

  test("walls agree between neighbours", () => {
    for (let cell = 0; cell < maze.cols * maze.rows; cell++)
      for (const n of Maze.neighbours(cell, maze.cols, maze.rows)) {
        const here = !!(maze.walls[cell] & Maze.step(cell, n, maze.cols));
        const there = !!(maze.walls[n] & Maze.step(n, cell, maze.cols));
        assert.equal(here, there, `squares ${cell} and ${n} disagree`);
      }
  });

  test("in at the top, out at the bottom: a way through, not a way in", () => {
    const start = maze.path[0], end = maze.path.at(-1);
    assert.ok(start < maze.cols, "the route starts on the top row");
    assert.ok(end >= maze.cols * (maze.rows - 1), "and ends on the bottom row");
    assert.ok(!(maze.walls[start] & Maze.N), "the way in is open");
    assert.ok(!(maze.walls[end] & Maze.S), "and so is the way out");
  });

  test("the edge of the grid is walled all the way round, bar those two openings", () => {
    const start = maze.path[0], end = maze.path.at(-1);
    let gaps = 0;
    for (let cell = 0; cell < maze.cols * maze.rows; cell++) {
      const col = cell % maze.cols, row = Math.floor(cell / maze.cols);
      if (row === 0 && !(maze.walls[cell] & Maze.N)) { gaps++; assert.equal(cell, start, `${cell} is open at the top`); }
      if (row === maze.rows - 1 && !(maze.walls[cell] & Maze.S)) { gaps++; assert.equal(cell, end, `${cell} is open at the bottom`); }
      if (col === 0) assert.ok(maze.walls[cell] & Maze.W, `${cell} is open on the left`);
      if (col === maze.cols - 1) assert.ok(maze.walls[cell] & Maze.E, `${cell} is open on the right`);
    }
    assert.equal(gaps, 2, "exactly two openings");
  });

  test("dead ends: there are squares the route never visits", () => {
    const off = maze.cols * maze.rows - maze.path.length;
    assert.ok(off >= 4, `${off} squares off the route`);
  });

  test("the same sentence always gives the same maze, on any machine", () => {
    assert.deepEqual(Maze.build(SENTENCE), maze, "built again, square for square");
    assert.deepEqual(Maze.build(SENTENCE), Maze.build(SENTENCE));
    assert.equal(maze.attempt, 0);
    assert.notDeepEqual(Maze.build(SENTENCE, 1).path, maze.path, "Try another gives a different one");
    assert.deepEqual(Maze.build(SENTENCE, 1), Maze.build(SENTENCE, 1), "and that one is repeatable too");
    assert.notDeepEqual(Maze.build(SENTENCE + " indeed").path, maze.path, "a different sentence, a different maze");
  });

  test("mazes for all sorts of sentences hold together", () => {
    for (const [i, sentence] of ["Four", "Teri Buana", SENTENCE, "A much longer sentence to walk through, with plenty of letters in it indeed",
      "1819 and 1822", "Façade — naïve, résumé"].entries()) {
      const m = Maze.build(sentence);
      assert.equal(Maze.problem(m), null, sentence);
      assert.equal(m.letters.length, Maze.letters(sentence).length, sentence);
      assert.equal(reachable(m).size, m.cols * m.rows, sentence);
      assert.equal(passages(m), m.cols * m.rows - 1, sentence);
      assert.ok(m.path[0] < m.cols, `${sentence}: starts on the top row`);
      assert.ok(m.path.at(-1) >= m.cols * (m.rows - 1), `${sentence}: ends on the bottom row`);
    }
  });

  test("a sentence with too few letters is refused in plain words", () => {
    for (const bad of ["", "   ", "Hi!", "...", null])
      assert.throws(() => Maze.build(bad), /at least 4 letters/);
  });
});

describe("checking a maze the game is given", () => {
  const good = Maze.build("Teri Buana");
  const copy = () => structuredClone(good);

  test("a sound maze has no problem", () => {
    assert.equal(Maze.problem(good), null);
  });

  test("every way a maze can be wrong is named", () => {
    assert.equal(Maze.problem(null), "the maze is missing");
    assert.equal(Maze.problem({ cols: 1, rows: 1 }), "the maze has no size");
    assert.equal(Maze.problem({ ...copy(), walls: [1, 2] }), "the maze's walls don't fit its size");
    assert.equal(Maze.problem({ ...copy(), path: [] }), "the maze has no route through it");
    assert.equal(Maze.problem({ ...copy(), letters: "ab" }), "the maze's letters don't fit its route");

    const outside = copy();
    outside.path[1] = 9999;
    assert.equal(Maze.problem(outside), "square 2 of the route is outside the maze");

    const jumps = copy();
    const after = jumps.path[2];                        // a square that is nowhere near square 3
    jumps.path[3] = [...Array(jumps.cols * jumps.rows).keys()].find(c =>
      c !== after && !Maze.neighbours(after, jumps.cols, jumps.rows).includes(c));
    assert.equal(Maze.problem(jumps), "the route jumps between squares 3 and 4");

    const walled = copy();
    walled.walls = [...walled.walls];
    walled.walls[walled.path[0]] |= Maze.step(walled.path[0], walled.path[1], walled.cols);
    assert.equal(Maze.problem(walled), "a wall blocks the route between squares 1 and 2");

    /* A route that doubles back: the last step goes back the way it came, so each pair is still
       neighbours with the wall open, and the only fault is the square being used twice. */
    const crosses = copy();
    crosses.path[crosses.path.length - 1] = crosses.path.at(-3);
    assert.equal(Maze.problem(crosses), "the route crosses itself");
  });
});
