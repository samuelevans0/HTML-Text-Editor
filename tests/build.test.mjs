import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("build produces dist/index.html + external dist/app.js", async () => {
  execFileSync("node", [join(root, "build/assemble.mjs")], { stdio: "inherit" });
  const html = await readFile(join(root, "dist", "index.html"), "utf8");
  const appJs = await readFile(join(root, "dist", "app.js"), "utf8");
  // The app bundle is now an external file (so a strict script-src 'self' CSP works),
  // referenced from index.html — the UI strings live in app.js, not inline in the HTML.
  assert.match(html, /<script src="app\.js">/);
  assert.match(appJs, /Open site folder/);
  assert.match(html, /<!DOCTYPE html>/);
  assert.ok(!/\{\{SCRIPT\}\}|\{\{SCRIPT_SRC\}\}|\{\{STYLE\}\}/.test(html), "no unreplaced slots");
});
