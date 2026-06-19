import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../server.mjs";
import { createServerFs } from "../src/serverFs.js";

let srv, fs;
before(async () => {
  const base = await mkdtemp(join(tmpdir(), "hsefs-"));
  await mkdir(join(base, "demo", "images"), { recursive: true });
  await writeFile(join(base, "demo", "index.html"), "<h1>Hi</h1>");
  await writeFile(join(base, "demo", "about.html"), "<h1>About</h1>");
  await writeFile(join(base, "demo", "images", "a.png"), "PNGDATA");
  const r = await start({ base, port: 0, open: false });
  srv = r.server;
  fs = createServerFs("demo", `http://127.0.0.1:${r.port}`);
});
after(() => srv.close());

test("readText fetches file text", async () => {
  assert.equal(await fs.readText("index.html"), "<h1>Hi</h1>");
});

test("rootHandle.values lists top-level entries", async () => {
  const names = [];
  for await (const e of fs.rootHandle.values()) names.push(e.kind + ":" + e.name);
  assert.ok(names.includes("file:index.html"));
  assert.ok(names.includes("file:about.html"));
  assert.ok(names.includes("directory:images"));
});

test("exists checks the cached file list", async () => {
  assert.equal(await fs.exists("images/a.png"), true);
  assert.equal(await fs.exists("nope.html"), false);
});

test("writeText persists and updates exists()", async () => {
  await fs.writeText("index.html", "<h1>Bye</h1>");
  assert.equal(await fs.readText("index.html"), "<h1>Bye</h1>");
});

test("uniqueName avoids collisions", async () => {
  assert.equal(await fs.uniqueName("images", "a.png"), "a-1.png");
  assert.equal(await fs.uniqueName("images", "b.png"), "b.png");
});
