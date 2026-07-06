import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/pages.js";
import { parseSource } from "../src/htmlSource.js";

const DOC = (body) =>
  `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

function editIdOf(html, tag) {
  const { byEditId } = parseSource(html);
  return [...byEditId.entries()]
    .sort((a, b) => a[0] - b[0])
    .find(([, n]) => n.tagName === tag)[0];
}

// Minimal in-memory filesystem matching the backend interface saveAll() uses.
function fakeFs(initial) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async readText(p) { if (!files.has(p)) throw new Error("ENOENT: " + p); return files.get(p); },
    async writeText(p, t) { files.set(p, t); },
    async writeBytes(p, b) { files.set(p, b); },
    async exists(p) { return files.has(p); },
    async uniqueName(_dir, base) { return base; },
  };
}

test("saveAll writes patched HTML when the file on disk matches the baseline", async () => {
  const path = "index.html";
  const html = DOC(`<h1>Old</h1>`);
  const fs = fakeFs({ [path]: html });
  const s = createSession(fs);
  s.ensure(path, html);
  s.recordEdit(path, { editId: editIdOf(html, "h1"), kind: "text", originalContent: "Old", replacement: "New" });

  const result = await s.saveAll();

  assert.equal(result.savedPages.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.match(fs.files.get(path), /<h1>New<\/h1>/);
});

test("saveAll refuses to overwrite a file changed on disk and reports a conflict", async () => {
  const path = "index.html";
  const html = DOC(`<h1>Old</h1>`);
  const fs = fakeFs({ [path]: html });
  const s = createSession(fs);
  s.ensure(path, html);
  s.recordEdit(path, { editId: editIdOf(html, "h1"), kind: "text", originalContent: "Old", replacement: "New" });

  // Something edits the file outside the editor after we loaded it.
  const external = DOC(`<h1>Old</h1><p>added externally</p>`);
  fs.files.set(path, external);

  const result = await s.saveAll();

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].path, path);
  assert.equal(result.savedPages.length, 0);
  assert.equal(fs.files.get(path), external, "external content preserved, not clobbered");
  assert.equal(s.globalDirty(), true, "in-editor edits are kept so they can be recovered");
});
