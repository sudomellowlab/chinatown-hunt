// Inlines src/ into one self-contained HTML file. Plain Node, no dependencies.
//   node build.js   →   dist/chinatown-hunt.html
import fs from "node:fs";
import path from "node:path";
const root = import.meta.dirname;
const src = f => fs.readFileSync(path.join(root, "src", f), "utf8");
const swap = (s, find, repl, what) => {
  if (s.split(find).length !== 2) throw new Error(`build: expected exactly one ${what}`);
  return s.replace(find, () => repl);   // function form: no $-pattern surprises
};

// The libraries and app.js become one inline module, so the import/export glue goes.
// Each library exports one object, which app.js imports under the same name.
const LIBS = { "engine.js": "Engine", "session.js": "Walk", "poi.js": "Poi" };
let app = src("app.js");
const libs = Object.entries(LIBS).map(([file, name]) => {
  app = swap(app, `import { ${name} } from "./${file}";\n`, "", `import of ${name} in app.js`);
  return swap(src(file), `\nexport { ${name} };\n`, "\n", `\`export { ${name} };\` in ${file}`).trim();
});
if (/^\s*(import|export)\b/m.test(app + libs.join("\n"))) throw new Error("build: unexpected import/export left over");

let html = src("index.html");
html = swap(html, '<link rel="stylesheet" href="styles.css">', `<style>\n${src("styles.css")}</style>`, "styles.css link");
html = swap(html, '<script type="module" src="app.js"></script>', `<script type="module">\n${[...libs, app.trim()].join("\n\n")}\n</script>`, "app.js script tag");

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "chinatown-hunt.html"), html);
console.log(`dist/chinatown-hunt.html  ${(html.length / 1024).toFixed(1)} KB`);
