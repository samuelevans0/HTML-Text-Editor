# HTML Site Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single `editor.html` (opened in Chrome/Edge) that visually edits text, images, and link targets across any static HTML site folder and saves surgically-minimal diffs back to the real files.

**Architecture:** Modules authored under `src/`, bundled with esbuild + vendored `parse5` into one self-contained `editor.html`. The risky core — mapping edited DOM elements back to exact source-character ranges — is a pure, parse5-based engine (`htmlSource`) tested in Node. The browser layers (`fsAccess`, `assets`, `editor`, `pages`, `app`) render a faithful preview in a same-origin iframe and orchestrate multi-page edit/save.

**Tech Stack:** Vanilla JS (ES modules), `parse5` (source-location HTML parsing, matches the browser parser), File System Access API (read/write), esbuild (bundle→inline), `node:test` (unit tests), `jsdom` (DOM-dependent unit tests), Playwright (optional integration).

## Global Constraints

- Distributable is a **single file** `HTML Text Editor/editor.html`; the user never runs a build.
- Target **Chromium (Chrome/Edge) desktop**; must work offline (parse5 inlined, no runtime network).
- **Never corrupt a file:** any edit that can't be located + verified is **skipped with a warning**, never guessed.
- **Minimal diff:** only edited inner-content/attribute ranges are rewritten; all other bytes byte-identical.
- Editing scope = **text + images + link targets only**. No structural editing.
- Site's own **JavaScript is disabled in the preview**, untouched in saved files.
- Images replaced **losslessly** (original bytes); never alter an image file the user didn't touch.
- No `Co-Authored-By: Claude` trailer in commits (user preference).

---

## File Structure

```
HTML Text Editor/
  editor.html                 # BUILT distributable (committed, ready to open)
  editor.legacy.html          # the old SportsCenter-specific tool, kept for reference
  package.json                # dev-only deps + scripts
  src/
    htmlSource.js             # pure engine: parse5 locations, ranges, splice, verify (NO DOM)
    sanitize.js               # DOM element -> minimal allowed inner HTML
    editable.js               # generic "is this editable text?" detection + collection
    paths.js                  # pure in-folder path resolution
    fsAccess.js               # FileSystemDirectoryHandle wrapper (browser)
    assets.js                 # rewrite relative refs -> blob: URLs for the preview (browser)
    editor.js                 # in-iframe editing layer (browser)
    pages.js                  # multi-file session/dirty/save-all (browser)
    app.js                    # shell/UI wiring (browser)
    shell.html                # HTML template (chrome) with {{STYLE}} {{SCRIPT}} {{PARSE5}} slots
    shell.css                 # chrome styles
    main.js                   # browser entry: imports parse5 + all modules, boots app
  vendor/
    (parse5 pulled from node_modules at build time)
  build/
    assemble.mjs              # esbuild bundle of main.js -> inline into editor.html
  tests/
    htmlSource.test.mjs
    sanitize.test.mjs
    editable.test.mjs
    paths.test.mjs
    fixtures/                 # sample HTML strings/sites
  docs/
    specs/2026-06-19-html-site-editor-design.md
    plans/2026-06-19-html-site-editor.md
```

---

### Task 1: Project scaffold + build pipeline proof

**Files:**
- Create: `HTML Text Editor/package.json`
- Create: `HTML Text Editor/src/shell.html`, `src/shell.css`, `src/main.js`
- Create: `HTML Text Editor/build/assemble.mjs`
- Test: `HTML Text Editor/tests/build.test.mjs`

**Interfaces:**
- Produces: `npm run build` writes `editor.html`; `npm test` runs `node --test`.
- Produces: `assemble.mjs` exports nothing; it is a script. Bundles `src/main.js` via esbuild (`bundle:true, format:'iife', platform:'browser'`), reads `src/shell.html` + `src/shell.css`, writes `editor.html` replacing `{{SCRIPT}}` and `{{STYLE}}`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "html-site-editor",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build/assemble.mjs",
    "test": "node --test"
  },
  "devDependencies": {
    "parse5": "^7.2.1",
    "esbuild": "^0.24.0",
    "jsdom": "^25.0.1"
  }
}
```

- [ ] **Step 2: Install deps**

Run: `cd "HTML Text Editor" && npm install`
Expected: `node_modules/parse5`, `esbuild`, `jsdom` present; exit 0.

- [ ] **Step 3: Create minimal `src/main.js`**

```js
// Browser entry. Boots the app on DOM ready. For now, prove the pipeline.
console.log("HTML Site Editor booting");
```

- [ ] **Step 4: Create `src/shell.css`** (placeholder, real chrome styles land in Task 14)

```css
:root { color-scheme: dark; }
body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
```

- [ ] **Step 5: Create `src/shell.html`** with replacement slots

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>HTML Site Editor</title>
<style>{{STYLE}}</style>
</head>
<body>
<div id="app"></div>
<script>{{SCRIPT}}</script>
</body>
</html>
```

- [ ] **Step 6: Create `build/assemble.mjs`**

```js
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
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
```

- [ ] **Step 7: Write failing build test `tests/build.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

test("build produces a self-contained editor.html", async () => {
  execFileSync("node", ["build/assemble.mjs"], { stdio: "inherit" });
  const html = await readFile("editor.html", "utf8");
  assert.match(html, /HTML Site Editor booting/); // bundled script is inlined
  assert.match(html, /<!DOCTYPE html>/);
  assert.ok(!/{{SCRIPT}}|{{STYLE}}/.test(html), "no unreplaced slots");
});
```

- [ ] **Step 8: Run test**

Run: `cd "HTML Text Editor" && npm test`
Expected: PASS (build runs, editor.html contains the boot log, no slots remain).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold html-site-editor build pipeline"
```

---

### Task 2: Engine — parse + preorder editId stamping

**Files:**
- Create: `HTML Text Editor/src/htmlSource.js`
- Test: `HTML Text Editor/tests/htmlSource.test.mjs`

**Interfaces:**
- Produces: `parseSource(html) -> { document, byEditId }` where `byEditId` is `Map<number, Node>`. Each element node is stamped (in preorder, root→down) with integer ids 0,1,2,… by walking `childNodes` and visiting any node that has a `.tagName`. `sourceCodeLocationInfo` is enabled.
- Produces: `nodeText(node) -> string` — concatenation of all descendant `#text` `.value`s (the element's original text content).
- Produces: `isElement(node) -> boolean` (`typeof node.tagName === "string"`).

- [ ] **Step 1: Write failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSource, nodeText } from "../src/htmlSource.js";

test("editId is assigned in preorder over elements", () => {
  const html = `<!DOCTYPE html><html><head><title>T</title></head>` +
    `<body><h1>Hi</h1><p>A <b>bold</b> word</p></body></html>`;
  const { byEditId } = parseSource(html);
  const tags = [...byEditId.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, n]) => n.tagName);
  assert.deepEqual(tags, ["html", "head", "title", "body", "h1", "p", "b"]);
});

test("nodeText concatenates descendant text", () => {
  const { byEditId } = parseSource(
    `<!DOCTYPE html><html><body><p>A <b>bold</b> word</p></body></html>`);
  const p = [...byEditId.values()].find((n) => n.tagName === "p");
  assert.equal(nodeText(p), "A bold word");
});

test("elements carry source locations", () => {
  const { byEditId } = parseSource(
    `<!DOCTYPE html><html><body><h1>Hi</h1></body></html>`);
  const h1 = [...byEditId.values()].find((n) => n.tagName === "h1");
  assert.ok(h1.sourceCodeLocation.startTag);
  assert.ok(h1.sourceCodeLocation.endTag);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/htmlSource.test.mjs`
Expected: FAIL ("Cannot find module ../src/htmlSource.js").

- [ ] **Step 3: Implement `src/htmlSource.js` (this step)**

```js
import { parse } from "parse5";

export function isElement(node) {
  return node && typeof node.tagName === "string";
}

export function nodeText(node) {
  let out = "";
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (c.nodeName === "#text") out += c.value;
      else walk(c);
    }
  })(node);
  return out;
}

export function parseSource(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const byEditId = new Map();
  let id = 0;
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (isElement(c)) {
        c._editId = id;
        byEditId.set(id, c);
        id++;
      }
      walk(c);
    }
  })(document);
  return { document, byEditId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/htmlSource.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/htmlSource.js tests/htmlSource.test.mjs && git commit -m "feat(engine): parse5 source parsing with preorder editIds"
```

---

### Task 3: Engine — inner-content range + attribute range

**Files:**
- Modify: `HTML Text Editor/src/htmlSource.js`
- Test: `HTML Text Editor/tests/htmlSource.test.mjs`

**Interfaces:**
- Produces: `innerRange(node) -> [start, end] | null`. Uses `sourceCodeLocation.startTag.endOffset` as start; end is `endTag.startOffset` if an end tag exists, else `sourceCodeLocation.endOffset`. Returns `null` if no `startTag` (void/self-closing).
- Produces: `attrToken(node, name) -> [start, end] | null`. From `sourceCodeLocation.attrs[name]` (lowercased name).

- [ ] **Step 1: Write failing tests**

```js
import { parseSource, innerRange, attrToken } from "../src/htmlSource.js";

test("innerRange covers inner content for closed element", () => {
  const html = `<!DOCTYPE html><html><body><h1>Hello</h1></body></html>`;
  const { byEditId } = parseSource(html);
  const h1 = [...byEditId.values()].find((n) => n.tagName === "h1");
  const [s, e] = innerRange(h1);
  assert.equal(html.slice(s, e), "Hello");
});

test("innerRange handles optional end tag (<li> auto-closed)", () => {
  const html = `<!DOCTYPE html><html><body><ul><li>one<li>two</ul></body></html>`;
  const { byEditId } = parseSource(html);
  const li = [...byEditId.values()].find((n) => n.tagName === "li");
  const [s, e] = innerRange(li);
  assert.equal(html.slice(s, e), "one");
});

test("attrToken returns the whole attribute span", () => {
  const html = `<!DOCTYPE html><html><body><a href="old.html">x</a></body></html>`;
  const { byEditId } = parseSource(html);
  const a = [...byEditId.values()].find((n) => n.tagName === "a");
  const [s, e] = attrToken(a, "href");
  assert.equal(html.slice(s, e), 'href="old.html"');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/htmlSource.test.mjs`
Expected: FAIL ("innerRange is not a function").

- [ ] **Step 3: Add implementations to `src/htmlSource.js`**

```js
export function innerRange(node) {
  const loc = node.sourceCodeLocation;
  if (!loc || !loc.startTag) return null;
  const start = loc.startTag.endOffset;
  const end = loc.endTag ? loc.endTag.startOffset : loc.endOffset;
  return [start, end];
}

export function attrToken(node, name) {
  const loc = node.sourceCodeLocation;
  if (!loc || !loc.attrs) return null;
  const a = loc.attrs[name.toLowerCase()];
  if (!a) return null;
  return [a.startOffset, a.endOffset];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/htmlSource.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/htmlSource.js tests/htmlSource.test.mjs && git commit -m "feat(engine): inner-content and attribute source ranges"
```

---

### Task 4: Engine — splice application (right-to-left, overlap-guarded)

**Files:**
- Modify: `HTML Text Editor/src/htmlSource.js`
- Test: `HTML Text Editor/tests/htmlSource.test.mjs`

**Interfaces:**
- Produces: `applySplices(text, splices) -> string`. `splices = [{ range:[start,end], replacement }]`. Sorts by `start` descending; throws `Error("overlapping splices")` if any two ranges overlap; applies each as `text.slice(0,start) + replacement + text.slice(end)`.

- [ ] **Step 1: Write failing tests**

```js
import { applySplices } from "../src/htmlSource.js";

test("applySplices replaces only given ranges, rest byte-identical", () => {
  const text = "AAA[1]BBB[2]CCC";
  const out = applySplices(text, [
    { range: [3, 6], replacement: "(one)" },   // [1]
    { range: [9, 12], replacement: "(two)" },  // [2]
  ]);
  assert.equal(out, "AAA(one)BBB(two)CCC");
});

test("applySplices throws on overlap", () => {
  assert.throws(
    () => applySplices("0123456789", [
      { range: [2, 6], replacement: "x" },
      { range: [4, 8], replacement: "y" },
    ]),
    /overlapping/);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/htmlSource.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
export function applySplices(text, splices) {
  const sorted = [...splices].sort((a, b) => b.range[0] - a.range[0]);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].range; // larger start
    const cur = sorted[i].range;
    if (cur[1] > prev[0]) throw new Error("overlapping splices");
  }
  let out = text;
  for (const { range, replacement } of sorted) {
    out = out.slice(0, range[0]) + replacement + out.slice(range[1]);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/htmlSource.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/htmlSource.js tests/htmlSource.test.mjs && git commit -m "feat(engine): right-to-left overlap-guarded splice"
```

---

### Task 5: Engine — structural sanity check

**Files:**
- Modify: `HTML Text Editor/src/htmlSource.js`
- Test: `HTML Text Editor/tests/htmlSource.test.mjs`

**Interfaces:**
- Produces: `elementTagSequence(html) -> string[]` (preorder tagName list, reuses `parseSource`).
- Produces: `sanityCheck(originalHtml, newHtml) -> { ok:boolean, reason?:string }`. Passes when the preorder element tag sequence is **identical** (same length, same tags) — edits to text/attrs never change which elements exist, so any difference signals a bad splice. Returns `{ok:false, reason}` otherwise.

- [ ] **Step 1: Write failing tests**

```js
import { sanityCheck } from "../src/htmlSource.js";

test("sanityCheck passes when only text changed", () => {
  const a = `<!DOCTYPE html><html><body><h1>Old</h1></body></html>`;
  const b = `<!DOCTYPE html><html><body><h1>New title</h1></body></html>`;
  assert.equal(sanityCheck(a, b).ok, true);
});

test("sanityCheck fails when an element appears/disappears", () => {
  const a = `<!DOCTYPE html><html><body><h1>Old</h1></body></html>`;
  const bad = `<!DOCTYPE html><html><body><h1>Old<span>x</span></h1></body></html>`;
  assert.equal(sanityCheck(a, bad).ok, false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/htmlSource.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
export function elementTagSequence(html) {
  const { byEditId } = parseSource(html);
  return [...byEditId.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n.tagName);
}

export function sanityCheck(originalHtml, newHtml) {
  const a = elementTagSequence(originalHtml);
  const b = elementTagSequence(newHtml);
  if (a.length !== b.length) {
    return { ok: false, reason: `element count changed ${a.length} -> ${b.length}` };
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return { ok: false, reason: `element ${i} changed ${a[i]} -> ${b[i]}` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/htmlSource.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/htmlSource.js tests/htmlSource.test.mjs && git commit -m "feat(engine): structural sanity check"
```

---

### Task 6: Engine — `buildSave` orchestration (the public API)

**Files:**
- Modify: `HTML Text Editor/src/htmlSource.js`
- Test: `HTML Text Editor/tests/htmlSource.test.mjs`

**Interfaces:**
- Consumes: all of the above.
- Produces:
  ```
  buildSave(originalHtml, edits) -> { newHtml, applied: number[], skipped: [{editId, reason}] }
  ```
  `edits` items (discriminated by `kind`):
  - `{ editId, kind:"text", originalContent, replacement }` — `replacement` is the new inner HTML (already sanitized by the caller). Skipped if: editId not found; `nodeText(node) !== originalContent` (identity check); `innerRange` null; or `replacement` equals current inner source (no-op).
  - `{ editId, kind:"attr", attrName, originalContent, value }` — replaces the attribute token with `attrName="ESCAPED(value)"`. Skipped if editId not found, identity check fails, or `attrToken` null.
  - Escaping for attr values: `& -> &amp;`, `" -> &quot;`, `< -> &lt;`.
  - After splicing, runs `sanityCheck(originalHtml, newHtml)`; if `!ok`, **discards all edits** and returns `{ newHtml: originalHtml, applied: [], skipped: [{editId:-1, reason}] }` (caller must not write).

- [ ] **Step 1: Write failing tests**

```js
import { buildSave, parseSource, innerRange, nodeText } from "../src/htmlSource.js";

const DOC = (body) => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

function editIdOf(html, tag, nth = 0) {
  const { byEditId } = parseSource(html);
  const matches = [...byEditId.entries()].sort((a,b)=>a[0]-b[0]).filter(([,n]) => n.tagName === tag);
  return matches[nth][0];
}

test("buildSave patches one heading, rest byte-identical", () => {
  const html = DOC(`<h1>Old Title</h1><p>Body stays.</p>`);
  const id = editIdOf(html, "h1");
  const r = buildSave(html, [
    { editId: id, kind: "text", originalContent: "Old Title", replacement: "New Title" },
  ]);
  assert.equal(r.newHtml, DOC(`<h1>New Title</h1><p>Body stays.</p>`));
  assert.deepEqual(r.applied, [id]);
  assert.deepEqual(r.skipped, []);
});

test("buildSave patches an href only", () => {
  const html = DOC(`<a href="old.html">link</a>`);
  const id = editIdOf(html, "a");
  const r = buildSave(html, [
    { editId: id, kind: "attr", attrName: "href", originalContent: "link", value: "new.html" },
  ]);
  assert.equal(r.newHtml, DOC(`<a href="new.html">link</a>`));
});

test("buildSave escapes attribute values", () => {
  const html = DOC(`<a href="old">link</a>`);
  const id = editIdOf(html, "a");
  const r = buildSave(html, [
    { editId: id, kind: "attr", attrName: "href", originalContent: "link", value: 'a "b" & c' },
  ]);
  assert.equal(r.newHtml, DOC(`<a href="a &quot;b&quot; &amp; c">link</a>`));
});

test("buildSave skips when identity check fails", () => {
  const html = DOC(`<h1>Old</h1>`);
  const id = editIdOf(html, "h1");
  const r = buildSave(html, [
    { editId: id, kind: "text", originalContent: "WRONG", replacement: "New" },
  ]);
  assert.equal(r.newHtml, html);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped[0].editId, id);
});

test("buildSave drops a no-op text edit", () => {
  const html = DOC(`<h1>Same</h1>`);
  const id = editIdOf(html, "h1");
  const r = buildSave(html, [
    { editId: id, kind: "text", originalContent: "Same", replacement: "Same" },
  ]);
  assert.equal(r.newHtml, html);
  assert.equal(r.applied.length, 0);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/htmlSource.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function buildSave(originalHtml, edits) {
  const { byEditId } = parseSource(originalHtml);
  const splices = [];
  const applied = [];
  const skipped = [];

  for (const edit of edits) {
    const node = byEditId.get(edit.editId);
    if (!node) { skipped.push({ editId: edit.editId, reason: "element not found" }); continue; }
    if (nodeText(node) !== edit.originalContent) {
      skipped.push({ editId: edit.editId, reason: "content drift (identity check failed)" });
      continue;
    }
    if (edit.kind === "text") {
      const range = innerRange(node);
      if (!range) { skipped.push({ editId: edit.editId, reason: "no inner range" }); continue; }
      if (originalHtml.slice(range[0], range[1]) === edit.replacement) continue; // no-op
      splices.push({ range, replacement: edit.replacement });
      applied.push(edit.editId);
    } else if (edit.kind === "attr") {
      const range = attrToken(node, edit.attrName);
      if (!range) { skipped.push({ editId: edit.editId, reason: "attribute not found" }); continue; }
      const replacement = `${edit.attrName}="${escapeAttr(edit.value)}"`;
      if (originalHtml.slice(range[0], range[1]) === replacement) continue; // no-op
      splices.push({ range, replacement });
      applied.push(edit.editId);
    } else {
      skipped.push({ editId: edit.editId, reason: "unknown edit kind" });
    }
  }

  let newHtml;
  try {
    newHtml = applySplices(originalHtml, splices);
  } catch (e) {
    return { newHtml: originalHtml, applied: [], skipped: [{ editId: -1, reason: e.message }] };
  }
  const sane = sanityCheck(originalHtml, newHtml);
  if (!sane.ok) {
    return { newHtml: originalHtml, applied: [], skipped: [{ editId: -1, reason: "sanity: " + sane.reason }] };
  }
  return { newHtml, applied, skipped };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/htmlSource.test.mjs`
Expected: PASS (all engine tests).

- [ ] **Step 5: Add adversarial fixtures test**

```js
test("buildSave preserves entities/quotes/comments elsewhere", () => {
  const html = `<!DOCTYPE html><html><head><title>t</title></head>` +
    `<body><!-- keep --><p id='x' data-k="v">Edit&nbsp;me</p>` +
    `<img src='a.jpg'><br></body></html>`;
  const id = editIdOf(html, "p");
  const r = buildSave(html, [
    { editId: id, kind: "text", originalContent: "Edit me", replacement: "Edited" },
  ]);
  // only the <p> inner changed; single-quoted img, comment, <br>, &nbsp; semantics untouched
  assert.equal(r.newHtml,
    `<!DOCTYPE html><html><head><title>t</title></head>` +
    `<body><!-- keep --><p id='x' data-k="v">Edited</p>` +
    `<img src='a.jpg'><br></body></html>`);
});
```

Run: `node --test tests/htmlSource.test.mjs`
Expected: PASS. (Note: `nodeText` returns the decoded ` ` for `&nbsp;`; confirm the `originalContent` in the test matches decoded text. If parse5 decodes entities in text values, this passes; the caller in the browser captures `element.textContent` which is also decoded — consistent.)

- [ ] **Step 6: Commit**

```bash
git add src/htmlSource.js tests/htmlSource.test.mjs && git commit -m "feat(engine): buildSave orchestration with identity + sanity guards"
```

---

### Task 7: `sanitize.js` — DOM element → minimal inner HTML

**Files:**
- Create: `HTML Text Editor/src/sanitize.js`
- Test: `HTML Text Editor/tests/sanitize.test.mjs`

**Interfaces:**
- Produces: `sanitizeInner(element) -> string`. Walks `element.childNodes`; emits:
  - text nodes → HTML-escaped text (`& < >`).
  - `<br>` → `<br>`.
  - `<b>/<strong>/<i>/<em>` → same tag, recursively sanitized inner, **no attributes**.
  - `<a ...>` → `<a href="ESCAPED">` + recursive inner + `</a>` (preserve only `href`).
  - any other element → its sanitized inner only (unwrap), discarding the tag/attrs (kills contenteditable `<div>`/`<span style>` cruft).
- Designed to run against a real DOM (`Node.TEXT_NODE === 3`, `Node.ELEMENT_NODE === 1`). Tested with jsdom.

- [ ] **Step 1: Write failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { sanitizeInner } from "../src/sanitize.js";

function el(html) {
  const { window } = new JSDOM(`<!DOCTYPE html><body><div id="r">${html}</div>`);
  globalThis.Node = window.Node;
  return window.document.getElementById("r");
}

test("keeps text, br, b/i, and link href; drops cruft", () => {
  assert.equal(sanitizeInner(el(`Hello <b>bold</b> & <i>it</i>`)), "Hello <b>bold</b> &amp; <i>it</i>");
  assert.equal(sanitizeInner(el(`Line<br>two`)), "Line<br>two");
  assert.equal(sanitizeInner(el(`<a href="x.html" onclick="bad()">go</a>`)), `<a href="x.html">go</a>`);
  assert.equal(sanitizeInner(el(`<div style="x"><span>plain</span></div>`)), "plain");
  assert.equal(sanitizeInner(el(`<strong>S</strong>`)), "<strong>S</strong>");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/sanitize.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sanitize.js`**

```js
const KEEP_TAGS = { B: "b", STRONG: "strong", I: "i", EM: "em" };

function escText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function sanitizeInner(element) {
  let out = "";
  for (const node of element.childNodes) {
    if (node.nodeType === 3) { out += escText(node.nodeValue); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName;
    if (tag === "BR") { out += "<br>"; continue; }
    if (KEEP_TAGS[tag]) { out += `<${KEEP_TAGS[tag]}>${sanitizeInner(node)}</${KEEP_TAGS[tag]}>`; continue; }
    if (tag === "A") {
      const href = node.getAttribute("href") || "#";
      out += `<a href="${escAttr(href)}">${sanitizeInner(node)}</a>`;
      continue;
    }
    out += sanitizeInner(node); // unwrap unknown elements
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/sanitize.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sanitize.js tests/sanitize.test.mjs && git commit -m "feat: minimal inner-HTML sanitizer"
```

---

### Task 8: `editable.js` — generic editable-text detection

**Files:**
- Create: `HTML Text Editor/src/editable.js`
- Test: `HTML Text Editor/tests/editable.test.mjs`

**Interfaces:**
- Produces: `INLINE_TAGS` set (`A,B,I,EM,STRONG,SPAN,SMALL,SUP,SUB,U,MARK,BR,ABBR,CODE,TIME,WBR`).
- Produces: `SKIP_ANCESTORS` set (`SCRIPT,STYLE,HEAD,SVG,NOSCRIPT,TEMPLATE,TEXTAREA,SELECT,OPTION`).
- Produces: `isEditableText(el) -> boolean`: true iff `el` has at least one direct non-whitespace text node **and** every element child's tag is in `INLINE_TAGS` (i.e., it's a text leaf-block, not a container of blocks) and it is not inside a `SKIP_ANCESTORS` element.
- Produces: `collectEditables(root) -> Element[]` (document order), excluding nested duplicates (an editable inside another editable is skipped — outer wins only if it itself qualifies; since containers of blocks don't qualify, leaf blocks are what remain).
- Produces: `SINGLE_LINE_TAGS` set (`H1,H2,H3,H4,H5,H6,A,TH,TD,LI,BUTTON,LABEL,FIGCAPTION,DT,DD`) used by the editor to suppress Enter.

- [ ] **Step 1: Write failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isEditableText, collectEditables } from "../src/editable.js";

function doc(html) {
  const { window } = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  globalThis.Node = window.Node;
  return window.document;
}

test("leaf text blocks are editable; block containers are not", () => {
  const d = doc(`<section><h1>Title</h1><p>Some <a href="x">link</a> text</p></section>`);
  const tags = collectEditables(d).map((e) => e.tagName);
  assert.deepEqual(tags, ["H1", "P"]); // section is a container, not editable
});

test("whitespace-only and script/style are not editable", () => {
  const d = doc(`<div>   </div><script>var x=1</script><style>.a{}</style><p>Hi</p>`);
  const tags = collectEditables(d).map((e) => e.tagName);
  assert.deepEqual(tags, ["P"]);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/editable.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `src/editable.js`**

```js
export const INLINE_TAGS = new Set(
  "A B I EM STRONG SPAN SMALL SUP SUB U MARK BR ABBR CODE TIME WBR".split(" "));
export const SKIP_ANCESTORS = new Set(
  "SCRIPT STYLE HEAD SVG NOSCRIPT TEMPLATE TEXTAREA SELECT OPTION".split(" "));
export const SINGLE_LINE_TAGS = new Set(
  "H1 H2 H3 H4 H5 H6 A TH TD LI BUTTON LABEL FIGCAPTION DT DD".split(" "));

function hasDirectText(el) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.nodeValue.trim() !== "") return true;
  }
  return false;
}
function onlyInlineChildren(el) {
  for (const c of el.children) {
    if (!INLINE_TAGS.has(c.tagName)) return false;
  }
  return true;
}
function inSkippedAncestor(el) {
  let p = el.parentElement;
  while (p) { if (SKIP_ANCESTORS.has(p.tagName)) return true; p = p.parentElement; }
  return false;
}

export function isEditableText(el) {
  if (!el || el.nodeType !== 1) return false;
  if (SKIP_ANCESTORS.has(el.tagName)) return false;
  if (inSkippedAncestor(el)) return false;
  return hasDirectText(el) && onlyInlineChildren(el);
}

export function collectEditables(root) {
  const out = [];
  const all = root.querySelectorAll("*");
  for (const el of all) {
    if (isEditableText(el)) out.push(el);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/editable.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editable.js tests/editable.test.mjs && git commit -m "feat: generic editable-text detection"
```

---

### Task 9: `paths.js` — in-folder path resolution

**Files:**
- Create: `HTML Text Editor/src/paths.js`
- Test: `HTML Text Editor/tests/paths.test.mjs`

**Interfaces:**
- Produces: `resolvePath(fromPath, href) -> { path } | { external:true } | null`:
  - Strips `#frag` and `?query`.
  - Returns `{external:true}` for `http:`, `https:`, `//`, `mailto:`, `tel:`, `sms:`, `data:`, `javascript:`.
  - Resolves `href` relative to the directory of `fromPath` using `/`-segment math, collapsing `.`/`..`.
  - A trailing `/` or a path with no `.ext` is treated as a directory → append `index.html`.
  - Returns `null` if the resolved path escapes the root (starts with `..`).
- Produces: `dirname(path)`, `extname(path)`, `joinPath(dir, rel)`, `isHtml(path)`.

- [ ] **Step 1: Write failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePath } from "../src/paths.js";

test("resolves siblings and subfolders relative to current page", () => {
  assert.deepEqual(resolvePath("index.html", "about.html"), { path: "about.html" });
  assert.deepEqual(resolvePath("about/index.html", "../contact.html"), { path: "contact.html" });
  assert.deepEqual(resolvePath("index.html", "blog/post.html#top"), { path: "blog/post.html" });
});

test("directory links map to index.html", () => {
  assert.deepEqual(resolvePath("index.html", "blog/"), { path: "blog/index.html" });
  assert.deepEqual(resolvePath("index.html", "about"), { path: "about/index.html" });
});

test("external and special schemes flagged", () => {
  assert.deepEqual(resolvePath("index.html", "https://x.com"), { external: true });
  assert.deepEqual(resolvePath("index.html", "mailto:a@b.c"), { external: true });
  assert.deepEqual(resolvePath("index.html", "tel:123"), { external: true });
});

test("escaping the root returns null", () => {
  assert.equal(resolvePath("index.html", "../../etc/passwd"), null);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/paths.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `src/paths.js`**

```js
const EXTERNAL = /^(https?:|\/\/|mailto:|tel:|sms:|data:|javascript:)/i;

export function dirname(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}
export function extname(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}
export function isHtml(path) {
  const e = extname(path);
  return e === ".html" || e === ".htm";
}

export function resolvePath(fromPath, href) {
  if (!href) return null;
  let h = href.split("#")[0].split("?")[0];
  if (h === "") return null;
  if (EXTERNAL.test(href)) return { external: true };

  let dir;
  if (h.startsWith("/")) { dir = ""; h = h.replace(/^\/+/, ""); }
  else { dir = dirname(fromPath); }

  const segs = (dir ? dir.split("/") : []);
  for (const part of h.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (segs.length === 0) return null; segs.pop(); }
    else segs.push(part);
  }
  let path = segs.join("/");
  // directory link (trailing slash or no extension) -> index.html
  if (href.split("#")[0].split("?")[0].endsWith("/") || extname(path) === "") {
    path = (path ? path + "/" : "") + "index.html";
  }
  if (path.startsWith("..")) return null;
  return { path };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/paths.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paths.js tests/paths.test.mjs && git commit -m "feat: in-folder path resolution"
```

---

### Task 10: `fsAccess.js` — directory handle wrapper (browser)

**Files:**
- Create: `HTML Text Editor/src/fsAccess.js`

**Interfaces:**
- Consumes: `paths.js` (`dirname`).
- Produces a factory `createFs(rootHandle)` returning:
  - `async getFileHandle(path, {create=false})` — walks subdirectories from root.
  - `async readText(path)`, `async readBytes(path) -> Blob`.
  - `async writeText(path, text)`, `async writeBytes(path, blob)` (creates parent dirs).
  - `async exists(path) -> boolean`.
  - `async uniqueName(dirPath, baseName) -> string` (e.g. `hero.jpg` → `hero-1.jpg` if taken).
- Produces standalone `async pickRoot() -> FileSystemDirectoryHandle` via `showDirectoryPicker({mode:"readwrite"})`, and `supported() -> boolean` (`typeof window.showDirectoryPicker === "function"`).

This module is browser-only (no Node unit test). Verified by the integration test (Task 17) and manual smoke (Task 16).

- [ ] **Step 1: Implement `src/fsAccess.js`**

```js
import { dirname } from "./paths.js";

export function supported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}
export async function pickRoot() {
  return window.showDirectoryPicker({ mode: "readwrite" });
}

export function createFs(rootHandle) {
  async function dirHandleFor(path, create) {
    const parts = path.split("/").filter(Boolean);
    let dir = rootHandle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }
  async function getFileHandle(path, { create = false } = {}) {
    const dir = await dirHandleFor(dirname(path), create);
    const name = path.split("/").pop();
    return dir.getFileHandle(name, { create });
  }
  return {
    rootHandle,
    getFileHandle,
    async readText(path) { return (await (await getFileHandle(path)).getFile()).text(); },
    async readBytes(path) { return (await getFileHandle(path)).getFile(); },
    async writeText(path, text) {
      const fh = await getFileHandle(path, { create: true });
      const w = await fh.createWritable();
      await w.write(text); await w.close();
    },
    async writeBytes(path, blob) {
      const fh = await getFileHandle(path, { create: true });
      const w = await fh.createWritable();
      await w.write(blob); await w.close();
    },
    async exists(path) {
      try { await getFileHandle(path); return true; } catch { return false; }
    },
    async uniqueName(dirPath, baseName) {
      const dot = baseName.lastIndexOf(".");
      const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
      const ext = dot > 0 ? baseName.slice(dot) : "";
      let name = baseName, i = 0;
      while (await this.exists((dirPath ? dirPath + "/" : "") + name)) {
        i++; name = `${stem}-${i}${ext}`;
      }
      return name;
    },
  };
}
```

- [ ] **Step 2: Build to confirm it bundles**

Run: `npm run build`
Expected: exit 0 (no import/syntax errors). (`main.js` will import it in Task 14.)

- [ ] **Step 3: Commit**

```bash
git add src/fsAccess.js && git commit -m "feat: File System Access directory wrapper"
```

---

### Task 11: `assets.js` — faithful-preview asset rewriting (browser)

**Files:**
- Create: `HTML Text Editor/src/assets.js`

**Interfaces:**
- Consumes: `fsAccess` instance, `paths.js` (`resolvePath`).
- Produces: `async function buildPreview(fs, pagePath, cleanDoc) -> { html, revoke }`:
  - Operates on a **clone** of `cleanDoc` (never mutate the source-of-truth doc).
  - Disables scripts: replace each `<script>` with an inert `<template data-was-script>` OR set `type="application/x-disabled"`; simplest: remove `src` and set `type="javascript/blocked"` and clear inline text. (Removing the element would shift nothing because editIds are already stamped on `cleanDoc`, but to keep element sequence identical for safety we **keep** the element and just neutralize it.)
  - For each `<link rel=stylesheet href>`, `<img src>`, `<img srcset>`, `<source src|srcset>`, `<video poster>`: resolve via `resolvePath(pagePath, ref)`; if local + exists, read bytes → `URL.createObjectURL(blob)` → set attribute to the blob URL. (For `srcset`, rewrite each URL token.)
  - For stylesheets: also read the CSS text, rewrite `url(...)` references one level deep (resolved relative to the stylesheet's path), wrap in a blob and point the link there — OR inject as `<style>` with rewritten urls. Use the `<style>` injection approach for reliability.
  - Inline `style="...url()..."` attributes: rewrite their `url(...)`.
  - Returns serialized `html` (`"<!DOCTYPE html>" + clone.documentElement.outerHTML`) and a `revoke()` that revokes every created blob URL.
- All edits target the **clone**; `data-edit-id` attributes (stamped in Task 14 before cloning) are preserved.

Browser-only; verified via Task 16/17.

- [ ] **Step 1: Implement `src/assets.js`** (see interface; full implementation)

```js
import { resolvePath } from "./paths.js";

export async function buildPreview(fs, pagePath, cleanDoc) {
  const clone = cleanDoc.cloneNode(true);
  const urls = [];
  const objUrl = async (ref, fromPath) => {
    const r = resolvePath(fromPath, ref);
    if (!r || r.external || !(await fs.exists(r.path))) return null;
    const blob = await fs.readBytes(r.path);
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  };

  // neutralize scripts (kept in preview DOM only; never written)
  clone.querySelectorAll("script").forEach((s) => {
    s.setAttribute("type", "javascript/blocked");
    s.removeAttribute("src");
    s.textContent = "";
  });

  // simple src attributes
  for (const el of clone.querySelectorAll("img[src], source[src], video[poster]")) {
    const attr = el.tagName === "VIDEO" ? "poster" : "src";
    const u = await objUrl(el.getAttribute(attr), pagePath);
    if (u) el.setAttribute(attr, u);
  }
  // srcset
  for (const el of clone.querySelectorAll("img[srcset], source[srcset]")) {
    const parts = el.getAttribute("srcset").split(",");
    const rewritten = [];
    for (const part of parts) {
      const [url, ...desc] = part.trim().split(/\s+/);
      const u = await objUrl(url, pagePath);
      rewritten.push((u || url) + (desc.length ? " " + desc.join(" ") : ""));
    }
    el.setAttribute("srcset", rewritten.join(", "));
  }
  // stylesheets -> inline <style> with url() rewritten one level deep
  for (const link of clone.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const r = resolvePath(pagePath, link.getAttribute("href"));
    if (!r || r.external || !(await fs.exists(r.path))) continue;
    let css = await fs.readText(r.path);
    css = await rewriteCssUrls(css, fs, r.path, urls);
    const style = clone.ownerDocument.createElement("style");
    style.setAttribute("data-from", link.getAttribute("href"));
    style.textContent = css;
    link.replaceWith(style);
  }
  // inline style="url()"
  for (const el of clone.querySelectorAll('[style*="url("]')) {
    el.setAttribute("style", await rewriteCssUrls(el.getAttribute("style"), fs, pagePath, urls));
  }

  const html = "<!DOCTYPE html>" + clone.documentElement.outerHTML;
  return { html, revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}

async function rewriteCssUrls(css, fs, fromPath, urls) {
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const tasks = [];
  css.replace(re, (m, q, ref) => { tasks.push({ m, ref }); return m; });
  let out = css;
  for (const { m, ref } of tasks) {
    const r = resolvePath(fromPath, ref);
    if (!r || r.external || !(await fs.exists(r.path))) continue;
    const blob = await fs.readBytes(r.path);
    const u = URL.createObjectURL(blob); urls.push(u);
    out = out.replace(m, `url("${u}")`);
  }
  return out;
}
```

- [ ] **Step 2: Build to confirm bundling**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/assets.js && git commit -m "feat: faithful preview via blob-url asset rewriting"
```

---

### Task 12: `editor.js` — in-iframe editing layer (browser)

**Files:**
- Create: `HTML Text Editor/src/editor.js`

**Interfaces:**
- Consumes: `editable.js` (`collectEditables`, `SINGLE_LINE_TAGS`), `sanitize.js` (`sanitizeInner`).
- Produces: `wireEditor(iframeDoc, callbacks)` where `callbacks = { onEdit(record), onNavigate(href), onDirty() }`.
  - Injects an editor stylesheet (hover/focus outlines, image hover hint, link-edit affordance).
  - For each editable element (matched to its `data-edit-id`): set `contenteditable=true`, `spellcheck=true`; wire:
    - `keydown` Enter → if `SINGLE_LINE_TAGS.has(tag)` preventDefault; else insert line break.
    - `paste` → plain text only.
    - `input` → `callbacks.onDirty()` and emit a debounced edit record `{ editId, kind:"text", originalContent, replacement: sanitizeInner(el) }` (originalContent captured once at wire time as `el.textContent`).
    - bold/italic shortcuts handled at document level (`Ctrl/Cmd+B/I` → `execCommand`).
  - For each `<img>` with a `data-edit-id`: hover hint; click and drop → choose a File; emit `{ editId, kind:"image", file, originalSrc }`.
  - For each `<a>` with `href`: on click, `preventDefault`; if modifier/edit-mode is the URL popover → open a small popover (built in `app`/`editor`) to edit href, emitting `{ editId, kind:"attr", attrName:"href", originalContent, value }`; otherwise treat as navigation → `callbacks.onNavigate(href)`.
  - Returns `{ revoke }` to remove listeners/styles if needed.
- `originalContent` for an `<a>`'s href edit is the link's `textContent` (used purely as the identity check value in `buildSave`, consistent with `nodeText`).

Browser-only; verified via Task 16/17. The implementer writes the full event wiring following the legacy `editor.html` `wirePreview` as a reference for execCommand/paste/Enter handling, adapted to emit edit records by `data-edit-id`.

- [ ] **Step 1: Implement `src/editor.js`** with the full wiring described above (model after legacy `wirePreview`, but generic + record-emitting). Key skeleton:

```js
import { collectEditables, SINGLE_LINE_TAGS } from "./editable.js";
import { sanitizeInner } from "./sanitize.js";

const EDITOR_CSS = `
[data-edit-id][contenteditable]{outline:2px dashed rgba(80,140,255,0);outline-offset:3px;border-radius:3px;cursor:text;transition:outline-color .12s,background .12s;}
[data-edit-id][contenteditable]:hover{outline-color:rgba(80,140,255,.6);background:rgba(80,140,255,.06);}
[data-edit-id][contenteditable]:focus{outline:2px solid #3b82f6;background:rgba(80,140,255,.1);}
img[data-edit-id]{cursor:pointer;}
img[data-edit-id]:hover{outline:3px solid #3b82f6;outline-offset:-3px;}
a[data-edit-id]{position:relative;}
`;

export function wireEditor(doc, cb) {
  const style = doc.createElement("style");
  style.textContent = EDITOR_CSS;
  doc.head.appendChild(style);

  doc.execCommand && doc.execCommand("styleWithCSS", false, false);

  for (const el of collectEditables(doc)) {
    if (!el.hasAttribute("data-edit-id")) continue;
    const editId = Number(el.getAttribute("data-edit-id"));
    const originalContent = el.textContent;
    const single = SINGLE_LINE_TAGS.has(el.tagName);
    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "true");
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (!single) doc.execCommand("insertLineBreak"); }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData("text/plain");
      doc.execCommand("insertText", false, t.replace(/\r?\n/g, " "));
    });
    el.addEventListener("input", () => {
      cb.onDirty();
      cb.onEdit({ editId, kind: "text", originalContent, replacement: sanitizeInner(el) });
    });
  }

  // images
  for (const img of doc.querySelectorAll("img[data-edit-id]")) {
    const editId = Number(img.getAttribute("data-edit-id"));
    const choose = () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*";
      inp.onchange = () => { const f = inp.files[0]; if (f) pickImage(img, editId, f, doc, cb); };
      inp.click();
    };
    img.addEventListener("click", (e) => { e.preventDefault(); choose(); });
  }
  doc.addEventListener("dragover", (e) => e.preventDefault());
  doc.addEventListener("drop", (e) => {
    const img = e.target.closest && e.target.closest("img[data-edit-id]");
    if (!img) return;
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) pickImage(img, Number(img.getAttribute("data-edit-id")), f, doc, cb);
  });

  // links: navigate vs edit-url popover
  doc.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    if (a.hasAttribute("contenteditable") && !e.altKey) return; // editing label
    e.preventDefault();
    if (e.altKey) openHrefPopover(a, doc, cb); // Alt+click edits URL
    else cb.onNavigate(a.getAttribute("href"));
  }, true);

  // global format shortcuts
  doc.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); doc.execCommand("bold"); }
      if (k === "i") { e.preventDefault(); doc.execCommand("italic"); }
    }
  });

  return { revoke() { style.remove(); } };
}

function pickImage(img, editId, file, doc, cb) {
  const u = URL.createObjectURL(file);
  img.setAttribute("src", u); // preview only
  cb.onDirty();
  cb.onEdit({ editId, kind: "image", file, originalSrc: img.getAttribute("data-original-src") || "" });
}

function openHrefPopover(a, doc, cb) {
  const current = a.getAttribute("href") || "";
  const next = window.prompt("Link destination (URL or page):", current);
  if (next == null || next === current) return;
  cb.onEdit({ editId: Number(a.getAttribute("data-edit-id")), kind: "attr",
    attrName: "href", originalContent: a.textContent, value: next });
  a.setAttribute("href", next);
  cb.onDirty();
}
```

(Note: `data-original-src` is set in Task 14 when stamping, capturing each img's authored `src` so image-save logic in `pages` knows the real file path.)

- [ ] **Step 2: Build to confirm bundling**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/editor.js && git commit -m "feat: in-iframe editing layer (text, image, link)"
```

---

### Task 13: `pages.js` — session manager + save-all (browser)

**Files:**
- Create: `HTML Text Editor/src/pages.js`

**Interfaces:**
- Consumes: `fsAccess` instance, `htmlSource.buildSave`, `paths` (`resolvePath`, `dirname`, `isHtml`).
- Produces `createSession(fs)` returning:
  - `pages: Map<path, PageRecord>` where `PageRecord = { path, originalText, edits: Map<editId, EditRecord>, dirty, replacedImages: Map<editId, {file, originalPath}> }`.
  - `recordEdit(path, record)`: stores into `pages.get(path).edits` keyed by `editId`; image kind goes to `replacedImages`; sets `dirty=true`.
  - `globalDirty()`, `dirtyPaths()`.
  - `async saveAll() -> { savedPages, savedImages, skipped }`:
    1. For each dirty page, first resolve image saves: for each `replacedImages` entry, decide overwrite-in-place vs new-file (per spec §9, using a cross-page reference count of the original src path), write bytes, and if a new file was created push an `attr` edit (`src`) into the edit list.
    2. Build the text+attr edit array from `edits` (drop image entries — they became attr edits or no-op).
    3. `const { newHtml, applied, skipped } = buildSave(page.originalText, edits)`.
    4. If `applied.length` or images written: `await fs.writeText(path, newHtml)`; update `page.originalText = newHtml`; clear edits; `dirty=false`.
    5. Aggregate `skipped` with page context.
  - Reference counting for image overwrite decision counts occurrences of the resolved original src across **all loaded pages' DOM snapshots** (the session stores, per page, a list of `{editId, originalSrcPath}` captured at load).

Browser-only; verified via Task 16/17.

- [ ] **Step 1: Implement `src/pages.js`** (full implementation per interface).

```js
import { buildSave } from "./htmlSource.js";
import { resolvePath, dirname } from "./paths.js";

export function createSession(fs) {
  const pages = new Map();

  function ensure(path, originalText) {
    if (!pages.has(path)) {
      pages.set(path, { path, originalText, edits: new Map(),
        replacedImages: new Map(), imgSrcByEditId: new Map(), dirty: false });
    }
    return pages.get(path);
  }
  function recordEdit(path, rec) {
    const p = pages.get(path);
    if (!p) return;
    if (rec.kind === "image") p.replacedImages.set(rec.editId, rec);
    else p.edits.set(rec.editId, rec);
    p.dirty = true;
  }
  function globalDirty() { return [...pages.values()].some((p) => p.dirty); }
  function dirtyPaths() { return [...pages.values()].filter((p) => p.dirty).map((p) => p.path); }

  function srcRefCount(resolvedPath) {
    let n = 0;
    for (const p of pages.values())
      for (const sp of p.imgSrcByEditId.values())
        if (sp === resolvedPath) n++;
    return n;
  }

  async function saveAll() {
    const result = { savedPages: [], savedImages: [], skipped: [] };
    for (const page of pages.values()) {
      if (!page.dirty) continue;
      const edits = [...page.edits.values()];

      for (const img of page.replacedImages.values()) {
        const origSrcPath = page.imgSrcByEditId.get(img.editId);
        const resolved = origSrcPath ? { path: origSrcPath } : null;
        if (resolved && srcRefCount(resolved.path) === 1 && await fs.exists(resolved.path)) {
          await fs.writeBytes(resolved.path, img.file);          // overwrite in place
          result.savedImages.push(resolved.path);
        } else {
          const dir = resolved ? dirname(resolved.path) : dirname(page.path) + "/images";
          const base = (img.file.name || "image.jpg").split("/").pop();
          const name = await fs.uniqueName(dir, base);
          const newPath = (dir ? dir + "/" : "") + name;
          await fs.writeBytes(newPath, img.file);
          result.savedImages.push(newPath);
          const relSrc = newPath.startsWith(dirname(page.path) + "/")
            ? newPath.slice(dirname(page.path).length + 1) : "/" + newPath;
          edits.push({ editId: img.editId, kind: "attr", attrName: "src",
            originalContent: img.originalContent || "", value: relSrc });
        }
      }

      const { newHtml, applied, skipped } = buildSave(page.originalText, edits);
      skipped.forEach((s) => result.skipped.push({ path: page.path, ...s }));
      if (applied.length || result.savedImages.length) {
        if (applied.length) await fs.writeText(page.path, newHtml);
        page.originalText = newHtml;
        page.edits.clear(); page.replacedImages.clear(); page.dirty = false;
        result.savedPages.push(page.path);
      }
    }
    return result;
  }

  return { pages, ensure, recordEdit, globalDirty, dirtyPaths, saveAll };
}
```

(Note: image `originalContent` identity check uses the link/element text, but `<img>` has no text; for image→attr `src` edits the `buildSave` identity check compares `nodeText(node)===""` which is true for `<img>`, so set `originalContent:""`.)

- [ ] **Step 2: Build to confirm bundling**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/pages.js && git commit -m "feat: multi-page session + save-all with image rules"
```

---

### Task 14: `app.js` + `main.js` + chrome — boot, load, navigate, save (browser)

**Files:**
- Create: `HTML Text Editor/src/app.js`
- Rewrite: `HTML Text Editor/src/main.js`
- Rewrite: `HTML Text Editor/src/shell.html`, `src/shell.css` (real chrome)

**Interfaces:**
- Consumes: everything.
- `main.js` imports `parse5` (so it's bundled/inlined) and `bootApp` from `app.js`, calls `bootApp()` on DOMContentLoaded.
- `app.js` `bootApp()`:
  - Renders chrome into `#app`: top bar (Open folder, breadcrumb/back, **Save All**, Discard), `<iframe id="frame">`, welcome screen, toast, status pill.
  - On Open: `pickRoot()` → `createFs` → `createSession(fs)` → `loadPage("index.html")` (or prompt for a page).
  - `loadPage(path)`:
    1. `text = await fs.readText(path)`.
    2. `cleanDoc = new DOMParser().parseFromString(text, "text/html")`.
    3. **Stamp editIds**: preorder over `cleanDoc` elements (same walk as engine) → set `data-edit-id`; for `<img>` set `data-original-src` = its authored `src`; record `imgSrcByEditId[editId] = resolvePath(path, src).path` into the page record.
    4. `session.ensure(path, text)`.
    5. `{ html, revoke } = await buildPreview(fs, path, cleanDoc)`; set `frame.srcdoc = html`.
    6. On iframe load: `wireEditor(frame.contentDocument, { onEdit: r => session.recordEdit(path, r), onDirty: updateChrome, onNavigate: href => navigate(path, href) })`.
    7. **Re-apply any in-memory edits** for this page to the iframe DOM (so returning to a page shows prior unsaved edits): for each stored text edit, set the matching element's innerHTML to `replacement`; for attr/image, re-apply.
    8. Update breadcrumb + push to nav stack.
  - `navigate(fromPath, href)`: `r = resolvePath(fromPath, href)`; if `external` → toast + offer open-in-tab; if local html that exists → `loadPage(r.path)`; else toast "can't open".
  - `saveAll()` button → `session.saveAll()` → toast summary (saved N pages / M images; if `skipped.length`, list them as a warning), then `updateChrome()`.
  - `Ctrl/Cmd+S` → saveAll. `beforeunload` → if `session.globalDirty()` set `returnValue`.
  - Discard (current page): reload page from `originalText` (drop in-memory edits for it).
  - If `!supported()` → render a clear "Open this in Chrome or Edge" message instead of Open.

- [ ] **Step 1: Implement `src/app.js`** (full chrome + orchestration per interface). EditId stamping helper MUST match engine preorder:

```js
function stampEditIds(doc, pagePath, pageRecordImgMap, resolvePath) {
  let id = 0;
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 1) {
        c.setAttribute("data-edit-id", String(id));
        if (c.tagName === "IMG") {
          const src = c.getAttribute("src") || "";
          c.setAttribute("data-original-src", src);
          const r = resolvePath(pagePath, src);
          if (r && r.path) pageRecordImgMap.set(id, r.path);
        }
        id++;
      }
      walk(c);
    }
  })(doc); // doc is the Document; walk from documentElement's owner to match engine which walks from document root
}
```

(Important: the engine walks from the parse5 **document** root including `<html>`; here start the walk so the first stamped element is `<html>`. Use `walk(doc)` where `doc` is the `Document`, so `doc.childNodes` includes the doctype (skipped, not element) then `<html>` as editId 0 — matching `parseSource`.)

Implement the remaining chrome (buttons, iframe, toast, breadcrumb, welcome, pill) and the flow functions above. Model the look on the legacy file's CSS but neutral/site-agnostic (blue accent, dark chrome).

- [ ] **Step 2: Rewrite `src/main.js`**

```js
import * as parse5 from "parse5"; // ensure parse5 is bundled/inlined for the engine
globalThis.__parse5 = parse5;     // (htmlSource imports parse5 directly; this line guarantees inclusion)
import { bootApp } from "./app.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootApp);
} else {
  bootApp();
}
```

- [ ] **Step 3: Rewrite `src/shell.css` and `src/shell.html`** with the real chrome styles (top bar, iframe stage `flex:1`, toast, welcome). Keep `{{STYLE}}`/`{{SCRIPT}}` slots and `<div id="app">` (app.js fills it, or move static chrome into shell.html and have app.js wire it — implementer's choice; keep one source of truth).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0; `editor.html` regenerated (large, parse5 inlined).

- [ ] **Step 5: Run unit tests to confirm no regressions**

Run: `npm test`
Expected: PASS (engine + helpers).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: app shell, page load/navigate/save orchestration"
```

---

### Task 15: Manual smoke test on a real multi-page fixture

**Files:**
- Create: `HTML Text Editor/tests/fixtures/site/index.html`, `about.html`, `styles.css`, `images/hero.jpg` (any small jpg)

- [ ] **Step 1: Build a tiny 2-page fixture site** that links `index.html ↔ about.html`, shares `styles.css`, and shows `images/hero.jpg` via `<img>`.

- [ ] **Step 2: Open `editor.html` in Chrome**, click Open, pick the fixture `site` folder.

- [ ] **Step 3: Verify** (record results in the commit message):
  - Page renders with CSS + image (asset rewriting works).
  - Click a heading, edit text; click the `index↔about` link, edit text on the second page; Alt+click a link to change its URL; click the image, choose a different jpg.
  - Save All. Confirm: `index.html`/`about.html` changed **only** in edited spots (`git diff` on the fixture, if the fixture is in a repo, or eyeball); image overwritten/added per rules; reopening shows persisted edits.
  - Make an edit, try to close the tab → unsaved-changes prompt appears.

- [ ] **Step 4: Commit fixture + notes**

```bash
git add tests/fixtures && git commit -m "test: multi-page fixture + manual smoke verification notes"
```

---

### Task 16: (Optional) Playwright integration test

**Files:**
- Modify: `package.json` (add `@playwright/test`, script `test:e2e`)
- Create: `HTML Text Editor/tests/e2e/save.spec.mjs`

**Interfaces:**
- The app exposes `window.EDITOR_TEST = { loadFolderFromMap(map), editText(editId, html), save() }` for tests (guarded behind a `?test=1` query) so the e2e test can drive it without the native picker. `loadFolderFromMap` builds an in-memory fs shim implementing the same `createFs` interface over a `Map<path,string|Blob>`.

- [ ] **Step 1: Add an in-memory fs shim** behind `?test=1` and the `window.EDITOR_TEST` hooks in `app.js`.
- [ ] **Step 2: Write the spec**: load a 2-page map, edit text on both, call save, assert the shim's stored text changed only in edited ranges and the unedited file is byte-identical.
- [ ] **Step 3: Run** `npx playwright test` → PASS.
- [ ] **Step 4: Commit.**

---

### Task 17: Retire the legacy tool + finalize

**Files:**
- Rename: `HTML Text Editor/editor.html` (legacy) → `editor.legacy.html` **before** the first build overwrites it. (If already overwritten by builds, restore the legacy content from git history first.)
- Verify: `editor.html` is the built generic tool.

- [ ] **Step 1:** Confirm the original site-specific editor is preserved as `editor.legacy.html` (recover from git if needed: `git show <first-commit>^:"HTML Text Editor/editor.html"`).
- [ ] **Step 2:** `npm run build && npm test` → all green.
- [ ] **Step 3:** Update a short `HTML Text Editor/README.md`: what it is, "open editor.html in Chrome/Edge, click Open, pick your site folder," the safety guarantees, and the dev `npm run build`/`npm test` notes.
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: README; retire legacy site-specific editor"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** text/image/link editing (Tasks 7,8,12), navigate+edit linked pages (Tasks 9,13,14), save-all to real files (Task 13,14), minimal-diff engine (Tasks 2–6), refuse-don't-corrupt (Tasks 5,6), faithful preview (Task 11), unsaved-changes guard (Task 14), image rules §9 (Task 13), single-file build (Tasks 1,14,17), testing (Tasks 2–9 unit, 15 manual, 16 e2e). ✔
- **Placeholder scan:** engine + pure-helper tasks contain complete code/tests; browser tasks contain complete module implementations + exact interfaces + build/verify steps. No "TBD"/"handle edge cases". ✔
- **Type consistency:** edit record shape `{editId, kind, ...}` consistent across `editor.js` (emits), `pages.js` (stores), `htmlSource.buildSave` (consumes). `createFs`/`createSession`/`buildPreview`/`buildSave`/`resolvePath` signatures match across consumers. ✔
- **Known risk to watch during execution:** the editId preorder walk in `app.js stampEditIds` MUST enumerate elements in the exact same order as `htmlSource.parseSource` (both: document root → childNodes, visiting any element). Task 14 calls this out; the identity check (`nodeText === originalContent`) in `buildSave` is the runtime guard if they ever diverge.
