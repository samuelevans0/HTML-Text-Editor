import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [join(root, "src/main.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
  legalComments: "none",
});
const script = result.outputFiles[0].text;

const shell = await readFile(join(root, "src/shell.html"), "utf8");
const style = await readFile(join(root, "src/shell.css"), "utf8");

const html = shell
  .replace("{{STYLE}}", () => style)
  .replace("{{SCRIPT}}", () => script);

await writeFile(join(root, "editor.html"), html, "utf8");
console.log("Wrote editor.html (" + html.length + " bytes)");

await mkdir(join(root, "dist"), { recursive: true });
await writeFile(join(root, "dist", "index.html"), html, "utf8");
console.log("Wrote dist/index.html (" + html.length + " bytes)");
