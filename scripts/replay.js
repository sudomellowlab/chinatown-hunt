#!/usr/bin/env node
// Replay a recorded walk through the geofence engine with chosen parameters.
//   node scripts/replay.js walks/2026-09-16-telok-ayer.json --radius 25 --ceiling 50 --streak 3
//   node scripts/replay.js walks/2026-09-16-telok-ayer.json --sweep
// Zero dependencies. Uses the same engine and walk-file parser as the app.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Engine } from "../src/engine.js";
import { Walk } from "../src/session.js";

const USAGE = `Usage: node scripts/replay.js <walk.json> [options]

  --radius <m>         use this geofence radius for every location (default: radii in the walk file)
  --ceiling <m>        accuracy ceiling (default: the walk's setting, else 50)
  --streak <n>         consecutive fixes inside to open (default: the walk's setting, else 3)
  --locations <file>   locations to test against: a walk file, or the capture tool's JSON array
                       (default: the locations saved in the walk file)
  --source <list>      only replay fixes from these sources, e.g. real or real,sim (default: all)
  --tz <zone>          time zone for clock times (default: Asia/Singapore)
  --sweep              replay over a grid of radius × ceiling and show which combinations open everything
  --radii <a:b:step>   radii for --sweep (default 10:50:5)
  --ceilings <a:b:step> ceilings for --sweep (default 20:100:10)
  --json               print the result as JSON
  -h, --help           show this help`;

const NEAR_M = 60;    // "near a location" for rejection stats; matches the manual-override range

/* ── analysis (pure, exported for tests) ──────────────────────────────── */

// Run fixes through the engine exactly as onFix does and report per location.
export function analyse(fixes, locations, cfg) {
  const per = new Map(locations.map((l, i) => [l.id, {
    n: i + 1, id: l.id, name: l.name ?? l.id, radius: Engine.radiusOf(l, cfg),
    opened: false, openedAt: null, openedFix: null, insideBy: null,
    closestAccepted: Infinity, closestAny: Infinity, bestStreak: 0,
    nearFixes: 0, nearRejected: 0, overrideReadyAt: null,
  }]));
  let prev = { streaks: {}, opened: [], nearSince: {} };
  let rejectedCeiling = 0, rejectedOther = 0;

  fixes.forEach((fix, i) => {
    const out = Engine.ingest(fix, locations, cfg, prev);
    prev = { streaks: out.streaks, opened: out.opened, nearSince: out.nearSince };

    // A fix that would pass with no ceiling was rejected by the ceiling alone.
    if (!out.screen.ok) {
      if (Engine.screen(fix, { ...cfg, accuracyCeiling: Infinity }).ok) rejectedCeiling++;
      else rejectedOther++;
    }
    for (const g of out.ranges) {
      if (!Number.isFinite(g.d)) continue;
      const p = per.get(g.id);
      p.closestAny = Math.min(p.closestAny, g.d);
      if (out.screen.ok) p.closestAccepted = Math.min(p.closestAccepted, g.d);
      if (g.d <= NEAR_M) { p.nearFixes++; if (!out.screen.ok) p.nearRejected++; }
      p.bestStreak = Math.max(p.bestStreak, out.streaks[g.id] || 0);
      if (out.fired.includes(g.id)) Object.assign(p, { opened: true, openedAt: fix.t, openedFix: i, insideBy: g.r - g.d });
    }
    for (const id of out.overrideReady) {
      const p = per.get(id);
      if (p.overrideReadyAt == null) p.overrideReadyAt = fix.t;
    }
  });

  const locs = [...per.values()];
  return {
    fixes: fixes.length, start: fixes[0]?.t ?? null, end: fixes.at(-1)?.t ?? null,
    rejectedCeiling, rejectedOther,
    opened: locs.filter(p => p.opened).length, total: locs.length,
    locations: locs,
  };
}

export const withRadius = (locations, radius) =>
  radius == null ? locations : locations.map(l => ({ ...l, radius }));

// Every radius × ceiling combination: how many locations open.
export function sweep(fixes, locations, cfg, radii, ceilings) {
  return radii.map(radius => ({
    radius,
    cells: ceilings.map(ceiling => {
      const a = analyse(fixes, withRadius(locations, radius), { ...cfg, radius, accuracyCeiling: ceiling });
      return { ceiling, opened: a.opened, total: a.total };
    }),
  }));
}

export function parseRange(text, flag) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(text ?? "");
  if (!m) throw new Error(`${flag} must look like from:to:step, e.g. 10:50:5`);
  const [from, to, step] = m.slice(1).map(Number);
  if (step <= 0 || to < from) throw new Error(`${flag}: need step > 0 and to >= from`);
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/* ── formatting ───────────────────────────────────────────────────────── */

const m1 = x => `${x.toFixed(1)} m`;
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : "—";
const elapsed = ms => {
  const s = Math.round(ms / 1000);
  return `+${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const clock = tz => {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return t => f.format(new Date(t));
};

export function formatReport(a, { file, cfg, radiusForced, sources, tz }) {
  const at = clock(tz), lines = [];
  const day = a.start != null ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium" }).format(new Date(a.start)) : "";
  lines.push(file);
  lines.push(`${a.fixes} fixes over ${elapsed(a.end - a.start).slice(1)} · ${day} ${at(a.start)}–${at(a.end)} (${tz}) · ${sources}`);
  lines.push(`Settings: radius ${radiusForced != null ? `${radiusForced} m for every location` : "from the walk file"} · ceiling ${cfg.accuracyCeiling} m · streak ${cfg.consecutiveFixes}`);
  lines.push(`Rejected: ${a.rejectedCeiling} of ${a.fixes} fixes (${pct(a.rejectedCeiling, a.fixes)}) over the ceiling` +
    (a.rejectedOther ? `, ${a.rejectedOther} malformed` : ""));
  lines.push(`Opened ${a.opened} of ${a.total}`);
  lines.push("");

  const nameW = Math.max(8, ...a.locations.map(p => p.name.length));
  for (const p of a.locations) {
    const head = `${String(p.n).padStart(2)}  ${p.name.padEnd(nameW)}  r ${String(p.radius).padStart(2)} m  `;
    let result;
    if (p.opened) {
      result = `OPENED ${at(p.openedAt)} (${elapsed(p.openedAt - a.start)}), ${m1(p.insideBy)} past the boundary`;
    } else if (Number.isFinite(p.closestAccepted)) {
      const outside = p.closestAccepted - p.radius;
      result = `not opened · closest accepted fix ${m1(p.closestAccepted)} ` +
        (outside > 0 ? `(${m1(outside)} outside)` : `(inside) · best streak ${p.bestStreak} of ${cfg.consecutiveFixes}`) +
        (p.closestAny < p.closestAccepted - 0.05 ? ` · closest of any fix ${m1(p.closestAny)}` : "");
    } else {
      result = Number.isFinite(p.closestAny) ? `not opened · no accepted fixes · closest of any fix ${m1(p.closestAny)}` : "not opened · no usable fixes";
    }
    lines.push(head + result);
    const extra = [`${pct(p.nearRejected, p.nearFixes)} of ${p.nearFixes} fixes within ${NEAR_M} m rejected`];
    if (!p.opened && p.overrideReadyAt != null) extra.push(`manual override available from ${at(p.overrideReadyAt)} (${elapsed(p.overrideReadyAt - a.start)})`);
    lines.push(`${" ".repeat(head.length)}${extra.join(" · ")}`);
  }
  return lines.join("\n");
}

export function formatSweep(grid, { file, fixes, cfg, total, sources }) {
  const lines = [];
  const ceilings = grid[0].cells.map(c => c.ceiling);
  lines.push(file);
  lines.push(`Sweep over ${fixes} fixes · streak ${cfg.consecutiveFixes} · ${sources} · radius applied to every location`);
  lines.push(`Each cell: locations opened out of ${total}. ✓ = all of them.`);
  lines.push("");
  const w = 6;
  lines.push("radius \\ ceiling".padEnd(17) + ceilings.map(c => `${c} m`.padStart(w)).join(""));
  for (const row of grid)
    lines.push(`${row.radius} m`.padStart(8).padEnd(17) + row.cells.map(c => (c.opened === c.total ? `✓${c.opened}` : String(c.opened)).padStart(w)).join(""));
  lines.push("");

  const winners = grid.flatMap(r => r.cells.filter(c => c.opened === c.total).map(c => ({ radius: r.radius, ceiling: c.ceiling })));
  if (!winners.length) {
    lines.push(`No combination opens all ${total} locations.`);
  } else {
    lines.push(`Combinations that open all ${total} (${winners.length}):`);
    lines.push(`  smallest radius for each ceiling:`);
    for (const c of ceilings) {
      const best = winners.filter(x => x.ceiling === c).sort((a, b) => a.radius - b.radius)[0];
      lines.push(`    ceiling ${String(c).padStart(3)} m → ${best ? `radius ${best.radius} m` : "none"}`);
    }
    lines.push(`  all: ${winners.map(x => `${x.radius}/${x.ceiling}`).join("  ")}   (radius/ceiling, m)`);
  }
  return lines.join("\n");
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

function readLocations(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const list = Array.isArray(data) ? data : data.locations;
  if (!Array.isArray(list) || !list.length) throw new Error(`${path}: no locations found`);
  return list;
}

export function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      radius: { type: "string" }, ceiling: { type: "string" }, streak: { type: "string" },
      locations: { type: "string" }, source: { type: "string" }, tz: { type: "string", default: "Asia/Singapore" },
      sweep: { type: "boolean" }, radii: { type: "string", default: "10:50:5" }, ceilings: { type: "string", default: "20:100:10" },
      json: { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
  if (o.help || positionals.length !== 1) return { code: o.help ? 0 : 2, out: USAGE };

  const file = positionals[0];
  const walk = Walk.parse(readFileSync(file, "utf8"));
  const num = (v, flag) => { if (v == null) return undefined; const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number`); return n; };

  let fixes = walk.fixes;
  if (o.source) { const keep = new Set(o.source.split(",")); fixes = fixes.filter(f => keep.has(f.source)); }
  if (!fixes.length) throw new Error(`no fixes left after --source ${o.source}`);

  const locations = o.locations ? readLocations(o.locations) : walk.locations;
  if (!locations?.length) throw new Error("this walk file has no saved locations; pass --locations <file>");

  const cfg = {
    radius: num(o.radius, "--radius") ?? walk.cfg?.radius ?? 25,
    accuracyCeiling: num(o.ceiling, "--ceiling") ?? walk.cfg?.accuracyCeiling ?? 50,
    consecutiveFixes: num(o.streak, "--streak") ?? walk.cfg?.consecutiveFixes ?? 3,
  };
  const counts = {};
  for (const f of fixes) counts[f.source] = (counts[f.source] || 0) + 1;
  const sources = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ");

  if (o.sweep) {
    const grid = sweep(fixes, locations, cfg, parseRange(o.radii, "--radii"), parseRange(o.ceilings, "--ceilings"));
    return { code: 0, out: o.json ? JSON.stringify({ file, cfg, grid }, null, 2)
      : formatSweep(grid, { file, fixes: fixes.length, cfg, total: locations.length, sources }) };
  }
  const radiusForced = num(o.radius, "--radius");
  const a = analyse(fixes, withRadius(locations, radiusForced), cfg);
  return { code: 0, out: o.json ? JSON.stringify({ file, cfg, radiusForced: radiusForced ?? null, ...a }, (k, v) => v === Infinity ? null : v, 2)
    : formatReport(a, { file, cfg, radiusForced, sources, tz: o.tz }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { code, out } = main(process.argv.slice(2));
    (code ? console.error : console.log)(out);
    process.exitCode = code;
  } catch (e) {
    console.error(`replay: ${e.message}`);
    process.exitCode = 1;
  }
}
