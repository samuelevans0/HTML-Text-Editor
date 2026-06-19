// Entry baked into helper.exe. Finds editor.html next to the executable and serves
// the folder above it. No top-level await (esbuild CJS output can't contain it).
import { start } from "../server.mjs";
import { dirname, join } from "node:path";

const exeDir = dirname(process.execPath);
const base = join(exeDir, "..");
const editorPath = join(exeDir, "editor.html");
const port = Number(process.env.PORT || 7777);

start({ base, port, open: true, editorPath }).then(({ url, base: b }) => {
  console.log(`HTML Site Editor helper serving ${b}\n  -> ${url}\nClose this window to stop.`);
});
