import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../server.mjs";

let srv, base, origin;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "hse-"));
  await mkdir(join(base, "demo", "images"), { recursive: true });
  await writeFile(join(base, "demo", "index.html"), "<!DOCTYPE html><html><body><h1>Hi</h1></body></html>");
  await writeFile(join(base, "demo", "styles.css"), "body{}");
  await mkdir(join(base, "node_modules"), { recursive: true });
  await writeFile(join(base, "node_modules", "junk.html"), "x");
  const r = await start({ base, port: 0, open: false });
  srv = r.server; origin = `http://127.0.0.1:${r.port}`;
});
after(() => srv.close());

// ---- Task 1: serving + file API ----

test("GET /editor.html serves the built editor", async () => {
  const r = await fetch(origin + "/editor.html");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Open site folder/);
});

test("sites lists folders with html, skipping denied dirs", async () => {
  const { sites } = await (await fetch(origin + "/__api/sites")).json();
  assert.ok(sites.includes("demo"));
  assert.ok(!sites.some((s) => s.includes("node_modules")));
});

test("list returns site files relative to the site root", async () => {
  const { files } = await (await fetch(origin + "/__api/list?site=demo")).json();
  assert.ok(files.includes("index.html"));
  assert.ok(files.includes("styles.css"));
});

test("read returns file contents with a content-type", async () => {
  const r = await fetch(origin + "/__api/read?site=demo&path=index.html");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /text\/html/);
  assert.match(await r.text(), /<h1>Hi<\/h1>/);
});

test("write persists bytes to disk", async () => {
  const r = await fetch(origin + "/__api/write?site=demo&path=index.html", {
    method: "PUT", body: "<!DOCTYPE html><html><body><h1>Bye</h1></body></html>",
  });
  assert.equal(r.status, 200);
  assert.match(await readFile(join(base, "demo", "index.html"), "utf8"), /<h1>Bye<\/h1>/);
});

test("write creates parent directories", async () => {
  const r = await fetch(origin + "/__api/write?site=demo&path=images/logo.svg", {
    method: "PUT", body: "<svg/>",
  });
  assert.equal(r.status, 200);
  assert.equal(await readFile(join(base, "demo", "images", "logo.svg"), "utf8"), "<svg/>");
});

// ---- Task 2: security ----

test("path traversal is rejected", async () => {
  const r = await fetch(origin + "/__api/read?site=demo&path=../../secret.txt");
  assert.equal(r.status, 403);
});

test("traversal via site is rejected", async () => {
  const r = await fetch(origin + "/__api/list?site=..");
  assert.equal(r.status, 403);
});

test("cross-origin api request is rejected", async () => {
  const r = await fetch(origin + "/__api/sites", { headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403);
});

test("same-origin request with matching Origin is allowed", async () => {
  const r = await fetch(origin + "/__api/sites", { headers: { Origin: origin } });
  assert.equal(r.status, 200);
});
