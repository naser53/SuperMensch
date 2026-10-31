// Builds dist/supermensch.html: one self-contained file (scripts, styles and the
// Vazirmatn font inlined) that runs offline straight from the disk, and
// dist/index.html, the same file for GitHub Pages, and server/public/index.html (the online server's start page).
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const r = p => path.join(root, p);

const js = await build({
  entryPoints: [r("js/main.js")], bundle: true, format: "iife", minify: true, write: false,
  target: ["es2020"], legalComments: "eof",
});
let css = fs.readFileSync(r("css/style.css"), "utf8");
for (const f of ["Vazirmatn-Regular.ttf", "Vazirmatn-Bold.ttf"]) {
  const b64 = fs.readFileSync(r("fonts/" + f)).toString("base64");
  css = css.replace(`url("../fonts/${f}")`, `url(data:font/ttf;base64,${b64})`);
}
let html = fs.readFileSync(r("index.html"), "utf8");
html = html.replace(/<!-- Development page[\s\S]*?<\/script>\n/, "")
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`)
  .replace('<script type="module" src="js/main.js"></script>',
           () => `<script>\n${js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`);
fs.mkdirSync(r("dist"), { recursive: true });
fs.writeFileSync(r("dist/supermensch.html"), html);
fs.writeFileSync(r("dist/index.html"), html);
fs.writeFileSync(r("server/public/index.html"), html);     // the game page of the online server (v2)
console.log("dist/supermensch.html", (html.length / 1024).toFixed(0), "KB");
