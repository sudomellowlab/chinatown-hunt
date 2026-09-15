// Inlines src/ into one self-contained HTML file. Plain Node, no dependencies.
//   node build.js   →   dist/chinatown-hunt.html
const fs = require("fs"), path = require("path");
const src = f => fs.readFileSync(path.join(__dirname, "src", f), "utf8");
const swap = (s, find, repl, what) => {
  if (s.split(find).length !== 2) throw new Error(`build: expected exactly one ${what}`);
  return s.replace(find, () => repl);   // function form: no $-pattern surprises
};

// engine.js and app.js become one inline module, so the import/export glue goes.
const engine = swap(src("engine.js"), /^export \{ Engine \};$/m, "", "`export { Engine };` in engine.js");
const app    = swap(src("app.js"), /^import \{ Engine \} from "\.\/engine\.js";$/m, "", "engine import in app.js");

let html = src("index.html");
html = swap(html, '<link rel="stylesheet" href="styles.css">', `<style>\n${src("styles.css")}</style>`, "styles.css link");
html = swap(html, '<script type="module" src="app.js"></script>', `<script type="module">\n${engine.trimEnd()}\n\n${app.trimStart()}</script>`, "app.js script tag");

fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist", "chinatown-hunt.html"), html);
console.log(`dist/chinatown-hunt.html  ${(html.length / 1024).toFixed(1)} KB`);
