# Cross-Browser Local Helper + Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor usable with full in-place saving in **any** browser via a tiny local Node helper, and let the user **drag-and-drop** a site folder to open it.

**Architecture:** A dependency-free Node HTTP helper (`server.mjs`) serves the built `editor.html` and a small file API over `127.0.0.1`. A new `serverFs.js` implements the exact same interface as `fsAccess.createFs`, backed by `fetch`, so the engine/editor/pages/assets are unchanged. `app.js` gains boot-mode detection (server vs `file://`) and window drag-and-drop.

**Tech Stack:** Node built-ins (`http`, `fs/promises`, `path`), global `fetch`/`Blob`/`File` (Node 24 + browsers), `node:test`, Puppeteer (headless, from parent `Websites/node_modules`).

## Global Constraints

- Helper uses **Node built-ins only** — no new npm dependencies.
- Helper **binds to `127.0.0.1`** only.
- Same minimal-diff / refuse-don't-corrupt save engine — **unchanged**.
- `serverFs` must expose the identical interface consumed by the app:
  `rootHandle{name, values()}`, `readText`, `readBytes`, `writeText`, `writeBytes`, `exists`, `uniqueName`.
- Path-traversal: every resolved path must stay within `BASE`; otherwise HTTP 403.
- Origin guard: `/__api/*` requests with a mismatched `Origin` header → HTTP 403. No CORS headers emitted.
- No `Co-Authored-By: Claude` trailer in commits.

---

## File Structure

```
HTML Text Editor/
  server.mjs                # NEW: local helper (exports start(); CLI when run directly)
  start.cmd                 # NEW: Windows launcher
  start.sh                  # NEW: macOS/Linux launcher
  src/serverFs.js           # NEW: helper-backed fs (createServerFs, inServerMode, siteFromQuery, fetchSites)
  src/app.js                # MODIFY: boot-mode detection + drag-and-drop + server site picker
  tests/server.test.mjs     # NEW: Node tests for the helper (roundtrip + security)
  tests/serverFs.test.mjs   # NEW: Node tests for serverFs against a live helper
  tests/e2e/server.mjs      # NEW: headless server-mode flow over http://localhost
  package.json              # MODIFY: add test:e2e-server script
```

---

### Task 1: `server.mjs` — serving + file API

**Files:**
- Create: `HTML Text Editor/server.mjs`
- Test: `HTML Text Editor/tests/server.test.mjs`

**Interfaces:**
- Produces: `start({ base, port=7777, open=false }) -> Promise<{ server, port, url, base }>`.
  Listens on `127.0.0.1`. If `port` is busy and non-zero, increments until free; `port:0` lets the OS choose.
- Routes:
  - `GET /` and `GET /editor.html` → the built `editor.html` (from the tool dir), `text/html`.
  - `GET /__api/sites` → `{ base: <basename>, sites: [relDir,…] }` — every directory under `base` (depth ≤ 4, skipping `DENY`) that **directly contains** an `.html`/`.htm` file. Paths use `/`.
  - `GET /__api/list?site=S` → `{ files: [relpath,…] }` — every file under `base/S` (skipping `DENY` dirs), relative to `base/S`, `/`-separated.
  - `GET /__api/read?site=S&path=P` → file bytes with `Content-Type` from extension; 404 if missing.
  - `PUT /__api/write?site=S&path=P` → writes the request body to `base/S/P` (creates parent dirs); `{ ok:true }`.
- `DENY = new Set(["node_modules",".git",".wrangler",".claude",".vscode","HTML Text Editor"])`.
- Browser auto-open (CLI only) is gated so tests never open a browser.

- [ ] **Step 1: Write the failing test** `tests/server.test.mjs`

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/server.test.mjs`
Expected: FAIL ("Cannot find module ../server.mjs").

- [ ] **Step 3: Implement `server.mjs`**

```js
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve, sep, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const DENY = new Set(["node_modules", ".git", ".wrangler", ".claude", ".vscode", "HTML Text Editor"]);
const MIME = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain",
};
const mimeFor = (p) => MIME[extname(p).toLowerCase()] || "application/octet-stream";

function makeHandler(BASE, port) {
  const safe = (site, path) => {
    const abs = resolve(BASE, site || "", path || "");
    if (abs !== BASE && !abs.startsWith(BASE + sep)) return null;
    return abs;
  };
  const originOk = (req) => {
    const o = req.headers.origin;
    if (!o) return true;
    return o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`;
  };

  async function listSites() {
    const out = [];
    async function walk(rel, depth) {
      if (depth > 4) return;
      let entries;
      try { entries = await readdir(join(BASE, rel), { withFileTypes: true }); } catch { return; }
      if (rel && entries.some((e) => e.isFile() && /\.html?$/i.test(e.name))) out.push(rel.split(sep).join("/"));
      for (const e of entries) if (e.isDirectory() && !DENY.has(e.name)) await walk(join(rel, e.name), depth + 1);
    }
    await walk("", 0);
    return out;
  }
  async function listFiles(root) {
    const files = [];
    async function walk(rel, depth) {
      if (depth > 8) return;
      let entries;
      try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) { if (!DENY.has(e.name)) await walk(join(rel, e.name), depth + 1); }
        else if (e.isFile()) files.push(join(rel, e.name).split(sep).join("/"));
      }
    }
    await walk("", 0);
    return files;
  }

  return async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "text/plain" }); res.end(body); };
    const json = (code, obj) => send(code, JSON.stringify(obj), "application/json");

    try {
      if (url.pathname === "/" || url.pathname === "/editor.html") {
        return send(200, await readFile(join(TOOL_DIR, "editor.html")), "text/html; charset=utf-8");
      }
      if (url.pathname.startsWith("/__api/")) {
        if (!originOk(req)) return send(403, "bad origin");
        const site = url.searchParams.get("site") || "";
        const path = url.searchParams.get("path") || "";

        if (url.pathname === "/__api/sites") {
          return json(200, { base: BASE.split(sep).pop(), sites: await listSites() });
        }
        if (url.pathname === "/__api/list") {
          const root = safe(site, "");
          if (!root) return send(403, "bad path");
          return json(200, { files: await listFiles(root) });
        }
        if (url.pathname === "/__api/read") {
          const abs = safe(site, path);
          if (!abs) return send(403, "bad path");
          try { return send(200, await readFile(abs), mimeFor(abs)); }
          catch { return send(404, "not found"); }
        }
        if (url.pathname === "/__api/write" && req.method === "PUT") {
          const abs = safe(site, path);
          if (!abs) return send(403, "bad path");
          const chunks = [];
          for await (const c of req) chunks.push(c);
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, Buffer.concat(chunks));
          return json(200, { ok: true });
        }
        return send(404, "no such api");
      }
      return send(404, "not found");
    } catch (e) {
      return send(500, "error: " + e.message);
    }
  };
}

export function start({ base, port = 7777, open = false } = {}) {
  const BASE = resolve(base);
  return new Promise((resolveP, rejectP) => {
    let tries = 0;
    const attempt = (p) => {
      const server = createServer();
      server.on("error", (err) => {
        if (err.code === "EADDRINUSE" && p !== 0 && tries < 50) { tries++; attempt(p + 1); }
        else rejectP(err);
      });
      server.listen(p, "127.0.0.1", () => {
        const actual = server.address().port;
        server.removeAllListeners("error");
        server.on("request", makeHandler(BASE, actual));
        const url = `http://localhost:${actual}/`;
        if (open) openBrowser(url);
        resolveP({ server, port: actual, url, base: BASE });
      });
    };
    attempt(port);
  });
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref(); } catch {}
}

// CLI: node server.mjs [baseDir] [port]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] || join(TOOL_DIR, "..");
  const port = Number(process.argv[3] || process.env.PORT || 7777);
  const { url, base: b } = await start({ base, port, open: !process.env.NO_OPEN });
  console.log(`HTML Site Editor helper serving ${b}\n  -> ${url}\nPress Ctrl+C to stop.`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/server.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server.mjs tests/server.test.mjs && git commit -m "feat(helper): local Node server serving editor + file API"
```

---

### Task 2: `server.mjs` — security (traversal + origin)

**Files:**
- Modify: (already implemented in Task 1; this task adds the proving tests)
- Test: `HTML Text Editor/tests/server.test.mjs`

**Interfaces:** uses Task 1's `start`.

- [ ] **Step 1: Add failing security tests** to `tests/server.test.mjs`

```js
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
```

- [ ] **Step 2: Run**

Run: `node --test tests/server.test.mjs`
Expected: PASS (10 tests total — the traversal/origin checks already exist in `safe`/`originOk`).

- [ ] **Step 3: Commit**

```bash
git add tests/server.test.mjs && git commit -m "test(helper): path-traversal and origin-guard coverage"
```

---

### Task 3: `src/serverFs.js` — helper-backed filesystem

**Files:**
- Create: `HTML Text Editor/src/serverFs.js`
- Test: `HTML Text Editor/tests/serverFs.test.mjs`

**Interfaces:**
- Produces: `createServerFs(site, origin="") -> fs` with the same shape as `fsAccess.createFs`.
  `origin` is `""` in the browser (same-origin relative `fetch`) and the server URL in Node tests.
- Produces: `inServerMode()`, `siteFromQuery()`, `fetchSites(origin="")` (browser helpers; not called in Node tests).

- [ ] **Step 1: Write the failing test** `tests/serverFs.test.mjs`

```js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../server.mjs";
import { createServerFs } from "../src/serverFs.js";

let srv, origin, fs;
before(async () => {
  const base = await mkdtemp(join(tmpdir(), "hsefs-"));
  await mkdir(join(base, "demo", "images"), { recursive: true });
  await writeFile(join(base, "demo", "index.html"), "<h1>Hi</h1>");
  await writeFile(join(base, "demo", "about.html"), "<h1>About</h1>");
  await writeFile(join(base, "demo", "images", "a.png"), "PNGDATA");
  const r = await start({ base, port: 0, open: false });
  srv = r.server; origin = `http://127.0.0.1:${r.port}`;
  fs = createServerFs("demo", origin);
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/serverFs.test.mjs`
Expected: FAIL ("Cannot find module ../src/serverFs.js").

- [ ] **Step 3: Implement `src/serverFs.js`**

```js
// Helper-backed filesystem: same interface as fsAccess.createFs, over fetch.
const API = "/__api";

export function inServerMode() {
  return typeof location !== "undefined" && (location.protocol === "http:" || location.protocol === "https:");
}
export function siteFromQuery() {
  return new URLSearchParams(location.search).get("site");
}
export async function fetchSites(origin = "") {
  const r = await fetch(`${origin}${API}/sites`);
  if (!r.ok) throw new Error("sites " + r.status);
  return r.json();
}

export function createServerFs(site, origin = "") {
  const q = (path) => `site=${encodeURIComponent(site)}&path=${encodeURIComponent(path)}`;
  let listCache = null;

  async function ensureList() {
    if (listCache) return listCache;
    const r = await fetch(`${origin}${API}/list?site=${encodeURIComponent(site)}`);
    if (!r.ok) throw new Error("list " + r.status);
    listCache = new Set((await r.json()).files);
    return listCache;
  }

  const api = {
    rootHandle: {
      name: site,
      async *values() {
        const set = await ensureList();
        const top = new Map();
        for (const p of set) {
          const seg = p.split("/");
          if (seg.length === 1) top.set(seg[0], "file");
          else if (!top.has(seg[0])) top.set(seg[0], "directory");
        }
        for (const [name, kind] of top) yield { kind, name };
      },
    },
    async readText(path) {
      const r = await fetch(`${origin}${API}/read?${q(path)}`);
      if (!r.ok) throw new Error("read " + path + " " + r.status);
      return r.text();
    },
    async readBytes(path) {
      const r = await fetch(`${origin}${API}/read?${q(path)}`);
      if (!r.ok) throw new Error("read " + path + " " + r.status);
      return r.blob();
    },
    async writeText(path, text) {
      const r = await fetch(`${origin}${API}/write?${q(path)}`, { method: "PUT", body: text });
      if (!r.ok) throw new Error("write " + path + " " + r.status);
      (await ensureList()).add(path);
    },
    async writeBytes(path, blob) {
      const r = await fetch(`${origin}${API}/write?${q(path)}`, { method: "PUT", body: blob });
      if (!r.ok) throw new Error("write " + path + " " + r.status);
      (await ensureList()).add(path);
    },
    async exists(path) {
      return (await ensureList()).has(path);
    },
    async uniqueName(dir, base) {
      const set = await ensureList();
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let name = base, i = 0;
      while (set.has((dir ? dir + "/" : "") + name)) { i++; name = `${stem}-${i}${ext}`; }
      return name;
    },
  };
  return api;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/serverFs.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/serverFs.js tests/serverFs.test.mjs && git commit -m "feat: serverFs backend (same interface as createFs, over fetch)"
```

---

### Task 4: `app.js` — boot-mode detection + server site picker

**Files:**
- Modify: `HTML Text Editor/src/app.js`

**Interfaces:**
- Consumes: `serverFs.js` (`inServerMode`, `siteFromQuery`, `fetchSites`, `createServerFs`), existing `startSession`, `supported`, `createFs`, `pickRoot`.
- Behavior in `bootApp()`:
  - If `inServerMode()`: render a **server welcome** with a site picker. If `siteFromQuery()` is set, auto-`startSession(createServerFs(site), site)`. The "Open site folder" button becomes "Choose a site" → re-renders the picker.
  - Else if `supported()`: current `file://` File System Access behavior.
  - Else: welcome explains "open `start.cmd` to edit in this browser".

- [ ] **Step 1: Add imports** at the top of `src/app.js`

```js
import { inServerMode, siteFromQuery, fetchSites, createServerFs } from "./serverFs.js";
```

- [ ] **Step 2: Implement `showSitePicker` and branch `bootApp`.** Replace the `if (!supported()) { … }` block in `bootApp` with:

```js
  if (inServerMode()) {
    bootServerMode();
  } else if (!supported()) {
    els.open.disabled = true;
    els.pill.textContent = "Needs the launcher";
    els.pill.className = "pill warn";
    showToast("To edit in this browser, start the helper: double-click <code>start.cmd</code>.", true);
    els.open.onclick = null;
    els.open.addEventListener("click", () => showToast("This browser can't save files directly. Double-click <code>start.cmd</code> and use the link it opens.", true));
  }
```

And add these functions to `app.js`:

```js
async function bootServerMode() {
  els.pill.textContent = "Helper connected";
  els.pill.className = "pill ok";
  els.open.textContent = "Choose a site";
  els.open.onclick = showSitePicker;
  const site = siteFromQuery();
  if (site) { await startSession(createServerFs(site), site); return; }
  await showSitePicker();
}

async function showSitePicker() {
  let data;
  try { data = await fetchSites(); }
  catch { showToast("Can't reach the local helper — is <code>start.cmd</code> running?", true); return; }
  els.frame.classList.remove("ready");
  els.welcome.style.display = "grid";
  const card = els.welcome.querySelector(".welcome-card");
  card.innerHTML = "<h1>Pick a site to edit</h1>";
  if (!data.sites.length) {
    card.append(h("p", { html: `No site folders found under <code>${escapeHtml(data.base)}</code>.` }));
    return;
  }
  card.append(h("p", { class: "hint", html: `Folders under <b>${escapeHtml(data.base)}</b> — or drag one onto this window.` }));
  const list = h("div", { class: "site-list" });
  for (const s of data.sites) {
    list.append(h("button", { class: "btn go site-btn", onclick: () => startSession(createServerFs(s), s) }, s));
  }
  card.append(list);
}
```

- [ ] **Step 3: Guard `openFolder()`** (the File System Access picker) so it isn't used in server mode. At the top of `openFolder`:

```js
  if (inServerMode()) return showSitePicker();
```

- [ ] **Step 4: Add site-list styles** to `src/shell.css`

```css
.site-list { display: flex; flex-direction: column; gap: .5rem; margin-top: 1.3rem; max-width: 26rem; margin-left: auto; margin-right: auto; }
.site-btn { justify-content: center; padding: .7rem 1rem; }
```

- [ ] **Step 5: Build + verify it bundles**

Run: `npm run build`
Expected: exit 0; `editor.html` regenerated.

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/shell.css && git commit -m "feat: server-mode boot + site picker"
```

---

### Task 5: `app.js` — drag-and-drop a site folder

**Files:**
- Modify: `HTML Text Editor/src/app.js`
- Test: `HTML Text Editor/tests/dragMatch.test.mjs`

**Interfaces:**
- Produces (pure, exported for test): `matchSite(name, sites) -> string | null` — returns the
  site whose last path segment equals `name` (exact, else case-insensitive), else `null`.
- Behavior: window `drop` →
  1. If `item.getAsFileSystemHandle` exists and yields a `directory` handle →
     `requestPermission({mode:"readwrite"})` → `startSession(createFs(handle), handle.name)`.
  2. Else read `item.webkitGetAsEntry()` name; if `inServerMode()` and `matchSite(name, sites)` →
     `startSession(createServerFs(match), match)`. Else toast the "move it under the base / use Chrome" notice.
- A drop overlay appears on dragenter/over.

- [ ] **Step 1: Write the failing test** `tests/dragMatch.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSite } from "../src/app.js";

test("matchSite finds exact last-segment match", () => {
  assert.equal(matchSite("Berry Hill Farm", ["Berry Hill Farm", "CubingClubs.net"]), "Berry Hill Farm");
  assert.equal(matchSite("public", ["Berry Hill Farm/public", "other"]), "Berry Hill Farm/public");
});

test("matchSite falls back to case-insensitive", () => {
  assert.equal(matchSite("berry hill farm", ["Berry Hill Farm"]), "Berry Hill Farm");
});

test("matchSite returns null when nothing matches", () => {
  assert.equal(matchSite("Nope", ["A", "B"]), null);
});
```

Note: `app.js` imports browser-only modules, but importing it in Node only needs the named
export `matchSite` to resolve. To keep this test pure, `matchSite` must not run any
browser code at module load. It is a standalone exported function; the rest of `app.js`
only executes inside `bootApp()` (called from `main.js`), so importing the module in Node
is side-effect-free.

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/dragMatch.test.mjs`
Expected: FAIL ("matchSite is not a function" or module import error).

- [ ] **Step 3: Implement.** Add to `src/app.js` (exported):

```js
export function matchSite(name, sites) {
  const last = (s) => s.split("/").pop();
  let m = sites.find((s) => last(s) === name);
  if (m) return m;
  m = sites.find((s) => last(s).toLowerCase() === String(name).toLowerCase());
  return m || null;
}
```

And wire drag-and-drop in `bootApp()` (replace the existing window `dragover`/`drop`
no-op handlers):

```js
  let sitesCache = null;
  const overlay = h("div", { class: "drop-overlay", id: "dropOverlay" }, "Drop a site folder to edit it");
  document.body.append(overlay);
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; overlay.classList.add("show"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => { e.preventDefault(); if (--dragDepth <= 0) overlay.classList.remove("show"); });
  window.addEventListener("drop", async (e) => {
    e.preventDefault(); dragDepth = 0; overlay.classList.remove("show");
    const item = e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items[0];
    if (!item) return;
    // Chromium: a writable directory handle (works in file:// and server mode)
    if (typeof item.getAsFileSystemHandle === "function") {
      try {
        const handle = await item.getAsFileSystemHandle();
        if (handle && handle.kind === "directory") {
          if (handle.requestPermission) { try { await handle.requestPermission({ mode: "readwrite" }); } catch {} }
          await startSession(createFs(handle), handle.name);
          return;
        }
      } catch {}
    }
    // Other browsers: match the dropped folder name to a helper site
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    const name = entry && entry.isDirectory ? entry.name : null;
    if (inServerMode() && name) {
      try {
        if (!sitesCache) sitesCache = (await fetchSites()).sites;
        const match = matchSite(name, sitesCache);
        if (match) { await startSession(createServerFs(match), match); return; }
      } catch {}
      showToast("Couldn't find <b>" + escapeHtml(name) + "</b> under the helper's folder. Move it there, or pick it from the list.", true);
      return;
    }
    showToast("To open a dropped folder here, use <b>Chrome/Edge</b>, or start the helper (<code>start.cmd</code>) and drag a site under its folder.", true);
  });
```

- [ ] **Step 4: Add overlay styles** to `src/shell.css`

```css
.drop-overlay { position: fixed; inset: 0; z-index: 100; display: none; place-items: center;
  background: rgba(37,99,235,.18); border: 3px dashed var(--accent); color: #fff;
  font-size: 1.4rem; font-weight: 700; backdrop-filter: blur(2px); }
.drop-overlay.show { display: grid; }
```

- [ ] **Step 5: Run the pure test + build**

Run: `node --test tests/dragMatch.test.mjs`
Expected: PASS (3 tests).
Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/shell.css tests/dragMatch.test.mjs && git commit -m "feat: drag-and-drop a site folder (writable handle or helper match)"
```

---

### Task 6: Launchers

**Files:**
- Create: `HTML Text Editor/start.cmd`
- Create: `HTML Text Editor/start.sh`

- [ ] **Step 1: Create `start.cmd`**

```bat
@echo off
cd /d "%~dp0"
echo Starting the HTML Site Editor helper...
node server.mjs
pause
```

- [ ] **Step 2: Create `start.sh`**

```sh
#!/bin/sh
cd "$(dirname "$0")"
echo "Starting the HTML Site Editor helper..."
node server.mjs
```

- [ ] **Step 3: Make `start.sh` executable + verify the helper boots**

Run: `chmod +x start.sh && NO_OPEN=1 node server.mjs 8123 & sleep 1 && curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8123/editor.html ; kill %1`
Expected: prints `200`.

(Windows alternative to verify: `node server.mjs` opens the browser; Ctrl+C to stop.)

- [ ] **Step 4: Commit**

```bash
git add start.cmd start.sh && git commit -m "feat: double-click launchers for the helper"
```

---

### Task 7: Headless server-mode integration test

**Files:**
- Create: `HTML Text Editor/tests/e2e/server.mjs`
- Modify: `HTML Text Editor/package.json` (add script)

**Interfaces:** uses `start` from `server.mjs` and Puppeteer (resolved from parent `Websites/node_modules`).

- [ ] **Step 1: Create `tests/e2e/server.mjs`**

```js
// Headless server-mode flow: real serverFs path over http://localhost (same code every
// browser runs in server mode). Edits two pages + an image, saves, asserts minimal diffs.
import puppeteer from "puppeteer";
import { start } from "../../server.mjs";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = await mkdtemp(join(tmpdir(), "hse2e-"));
await mkdir(join(base, "demo"), { recursive: true });
const IDX = `<!DOCTYPE html>\n<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head>\n<body>\n<h1>Welcome</h1>\n<p>Visit <a href="about.html">about</a>.</p>\n</body></html>\n`;
const ABT = `<!DOCTYPE html>\n<html><head><title>About</title></head>\n<body>\n<h1>About</h1>\n</body></html>\n`;
await writeFile(join(base, "demo", "index.html"), IDX);
await writeFile(join(base, "demo", "about.html"), ABT);
await writeFile(join(base, "demo", "styles.css"), "h1{color:#111}\n");

const { server, port } = await start({ base, port: 0, open: false });
const origin = `http://127.0.0.1:${port}`;

let failures = 0;
const check = (n, ok) => { console.log((ok ? "  PASS  " : "  FAIL  ") + n); if (!ok) failures++; };

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.log("  PAGEERROR:", e.message); failures++; });
  await page.goto(`${origin}/editor.html?site=demo`, { waitUntil: "load" });
  await page.waitForFunction('document.getElementById("frame") && document.getElementById("frame").classList.contains("ready")', { timeout: 10000 });
  check("auto-loaded site=demo (index.html)", true);

  // edit the index heading (h1 is editId 4 here: html,head,title,body? -> compute live)
  const h1Id = await page.evaluate(() => document.getElementById("frame").contentDocument.querySelector("h1").getAttribute("data-edit-id"));
  await page.evaluate((id) => {
    const d = document.getElementById("frame").contentDocument;
    const el = d.querySelector(`[data-edit-id="${id}"]`);
    el.innerHTML = "Welcome home"; el.dispatchEvent(new Event("input", { bubbles: true }));
  }, h1Id);

  // navigate to about via the link, edit its heading
  await page.evaluate(() => {
    const d = document.getElementById("frame").contentDocument;
    d.querySelector('a[href="about.html"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForFunction('document.getElementById("crumb").textContent === "about.html"', { timeout: 5000 });
  const aboutH1 = await page.evaluate(() => document.getElementById("frame").contentDocument.querySelector("h1").getAttribute("data-edit-id"));
  await page.evaluate((id) => {
    const d = document.getElementById("frame").contentDocument;
    const el = d.querySelector(`[data-edit-id="${id}"]`);
    el.innerHTML = "About Us"; el.dispatchEvent(new Event("input", { bubbles: true }));
  }, aboutH1);

  await page.evaluate(() => document.getElementById("save").click());
  await page.waitForFunction('document.getElementById("save").disabled === true', { timeout: 5000 });

  const idx = await readFile(join(base, "demo", "index.html"), "utf8");
  const abt = await readFile(join(base, "demo", "about.html"), "utf8");
  const css = await readFile(join(base, "demo", "styles.css"), "utf8");
  check("index heading saved", idx.includes("<h1>Welcome home</h1>"));
  check("index link untouched", idx.includes('<a href="about.html">about</a>'));
  check("about heading saved", abt.includes("<h1>About Us</h1>"));
  check("styles.css byte-identical", css === "h1{color:#111}\n");
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
console.log("\nAll server-mode integration checks passed.");
```

- [ ] **Step 2: Add script** to `package.json` (after `test:e2e`)

```json
    "test:e2e": "node tests/e2e/run.mjs",
    "test:e2e-server": "node tests/e2e/server.mjs"
```

- [ ] **Step 3: Run**

Run: `npm run build && npm run test:e2e-server`
Expected: all checks PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/server.mjs package.json && git commit -m "test: headless server-mode integration over http"
```

---

### Task 8: Finalize — full suite, README, build

**Files:**
- Modify: `HTML Text Editor/README.md`

- [ ] **Step 1: Update `README.md`** — add a "Works in any browser (the helper)" section:

```markdown
## Works in any browser (Firefox, Safari, Brave, Mullvad, …)

Direct `file://` saving only works in Chromium browsers. For **any** browser, run the helper:

1. Double-click **`start.cmd`** (Windows) or **`start.sh`** (macOS/Linux).
2. Your browser opens to `http://localhost:7777`. Pick a site (or drag a folder in).
3. Edit and **Save All** — the helper writes the real files. Works identically in Firefox,
   Safari, Brave, Mullvad, Chrome, Edge, etc.

The helper is a tiny Node server bound to `127.0.0.1` (localhost only), with path-traversal
protection and an Origin check so other websites can't reach your files.
```

- [ ] **Step 2: Full build + all tests**

Run: `npm run build && npm test && npm run test:e2e && npm run test:e2e-server`
Expected: unit suite PASS; both e2e suites PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md editor.html && git commit -m "docs: document the cross-browser helper"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** helper server (Task 1), security/traversal/origin (Task 2), serverFs same-interface backend (Task 3), boot-mode detection + server site picker (Task 4), drag-and-drop with writable-handle + name-match (Task 5), launchers (Task 6), browser-agnostic verification via headless server-mode e2e (Task 7), docs (Task 8). ✔
- **Placeholder scan:** every code step contains complete code; tests contain real assertions. No "handle edge cases"/"TBD". ✔
- **Type/interface consistency:** `createServerFs(site, origin)` shape matches `createFs` consumers (`rootHandle.values`, `readText/Bytes`, `writeText/Bytes`, `exists`, `uniqueName`); `start({base,port,open})` returns `{server,port,url,base}` used identically in all three test files; `matchSite(name, sites)` signature consistent between Task 5 impl/test. ✔
- **Watch during execution:** `app.js` must remain import-safe in Node (the `matchSite` test imports it). The module only executes browser code inside `bootApp()`, so a bare `import { matchSite }` is side-effect-free — but confirm no top-level `document`/`window` access creeps in. If Node import ever fails, move `matchSite` into a tiny `src/dragMatch.js` and import it from both `app.js` and the test.
```
