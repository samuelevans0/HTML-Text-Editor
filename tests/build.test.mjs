import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("build produces a self-contained editor.html", async () => {
  execFileSync("node", [join(root, "build/assemble.mjs")], { stdio: "inherit" });
  const html = await readFile(join(root, "editor.html"), "utf8");
  assert.match(html, /Open site folder/); // bundled app script is inlined
  assert.match(html, /<!DOCTYPE html>/);
  assert.ok(!/\{\{SCRIPT\}\}|\{\{STYLE\}\}/.test(html), "no unreplaced slots");
});
