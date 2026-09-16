// Builds the two deliverables from src/. Plain Node, no dependencies.
//   node build.js   →   dist/chinatown-hunt-admin.html   the admin file: set up, test, export
//                       dist/chinatown-hunt.html         a participant file with the default game
import fs from "node:fs";
import path from "node:path";
import { GAME } from "./src/game.js";
import { Pack } from "./src/pack.js";
import { Play } from "./src/play.js";

const root = import.meta.dirname;
const src = f => fs.readFileSync(path.join(root, "src", f), "utf8");
const swap = (s, find, repl, what) => {
  if (s.split(find).length !== 2) throw new Error(`build: expected exactly one ${what}`);
  return s.replace(find, () => repl);   // function form: no $-pattern surprises
};

// Each module imports only from sibling modules. Inlined into one <script type="module">,
// the import and export lines go and the files share a single scope.
function inline(file, text = src(file)) {
  const out = text.replace(/^import \{[^}]*\} from "\.\/[\w-]+\.js";\n/gm, "").replace(/^export \{[^}]*\};\n/gm, "");
  if (/^\s*(import|export)\b/m.test(out)) throw new Error(`build: unexpected import/export left in ${file}`);
  return out.trim();
}

// The same page for both files; the participant file drops everything between admin markers.
function page(admin, modules) {
  let html = src("index.html");
  if (!admin) {
    html = html.replace(/<!-- admin:start -->[\s\S]*?<!-- admin:end -->\n?/g, "");
    html = swap(html, 'data-build="admin"', 'data-build="play"', "data-build attribute");
  }
  html = html.replace(/<!-- admin:(start|end) -->\n?/g, "");
  if (html.includes("admin:start") || html.includes("admin:end")) throw new Error("build: unbalanced admin markers");
  html = swap(html, '<link rel="stylesheet" href="styles.css">', `<style>\n${src("styles.css")}</style>`, "styles.css link");
  html = swap(html, '<script type="module" src="admin.js"></script>', `<script type="module">\n${modules.join("\n\n")}\n</script>`, "admin.js script tag");
  return html;
}

// Participant page: the game only, with its content left as a slot for a sealed pack.
const template = page(false, [inline("engine.js"), inline("play.js"), inline("pack.js"), 'const GAME = Pack.open("__GAME_PACK__");', inline("app.js")]);
for (const admin of ['id="drawer"', 'id="devbtn"', "setPoi", "Walk.record", "__PARTICIPANT_TEMPLATE__"])
  if (template.includes(admin)) throw new Error(`build: admin code leaked into the participant file (${admin})`);

// Admin page: everything, plus the participant page embedded so Export can produce it.
const templateLiteral = JSON.stringify(template).replace(/</g, "\\u003c");
const adminPage = page(true, [
  inline("engine.js"), inline("play.js"), inline("session.js"), inline("poi.js"), inline("pack.js"), inline("game.js"), inline("app.js"),
  swap(inline("admin.js"), '"__PARTICIPANT_TEMPLATE__"', templateLiteral, "participant template slot in admin.js"),
]);

// A playable participant file with the default game, as a sanity check and for CI.
const playable = swap(template, '"__GAME_PACK__"', JSON.stringify(Pack.seal(GAME)), "game pack slot");
for (const l of GAME.locations)
  for (const text of [l.name, l.arrivalText, ...(l.tasks || []).flatMap(t => [t.prompt, t.hint, ...(t.options || []), ...(t.accept || []).filter(a => a.length > 5)])])
    if (text && playable.includes(text)) throw new Error(`build: readable game content in the participant file ("${text.slice(0, 30)}")`);
for (const text of [...(GAME.clues || []).map(c => c.text), ...(GAME.suspects || []).flatMap(s => [s.name, s.blurb]), ...Play.imageUrls(GAME)])
  if (text && playable.includes(text)) throw new Error(`build: readable clue or suspect in the participant file ("${text.slice(0, 30)}")`);

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
for (const [name, html] of [["chinatown-hunt-admin.html", adminPage], ["chinatown-hunt.html", playable]]) {
  fs.writeFileSync(path.join(root, "dist", name), html);
  console.log(`dist/${name}`.padEnd(32), `${(html.length / 1024).toFixed(1)} KB`);
}
