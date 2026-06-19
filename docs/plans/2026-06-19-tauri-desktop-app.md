# Tauri Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing HTML Site Editor in a Tauri v2 desktop shell that ships as a single portable `.exe` — no browser, no installer, no helper server needed.

**Architecture:** `build/assemble.mjs` already bundles all frontend code into a single HTML file; we extend it to also output `dist/index.html` which Tauri serves in a native WebView2 window. A new `src/tauriFs.js` implements the existing `createFs()`-compatible interface using six custom Rust commands instead of the browser File System Access API. `app.js` detects `window.__TAURI__` at startup and switches to the Tauri adapter; the server-mode and Chrome-specific codepaths remain unchanged so the standalone `editor.html` browser workflow still works.

**Tech Stack:** Tauri v2, Rust (std::fs — no extra crates), `tauri-plugin-dialog` for the native folder picker, `withGlobalTauri: true` (Tauri injects `window.__TAURI__.*` into the webview so no JS bundler changes are needed), esbuild already present.

## Global Constraints

- Tauri v2 only (not v1). All configs and APIs are v2.
- `withGlobalTauri: true` must be set in `tauri.conf.json` — this is what makes `window.__TAURI__.*` available without an npm import.
- All Rust commands use synchronous `std::fs` (no async) — Tauri wraps them in a thread pool automatically.
- The existing `editor.html` at the project root and `helper.exe` / `server.mjs` must continue to work unchanged (for browser users).
- No new npm runtime dependencies — only `@tauri-apps/cli` as a devDependency.
- Do NOT use `cargo tauri init` — create the `src-tauri/` files manually as specified below to avoid overwriting project files.
- Existing unit tests (`npm test`) must still pass throughout.

---

### Task 1: Tauri scaffold — project files, Rust commands, assemble.mjs dist output

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/icons/` (placeholder icons — real ones in Task 3)
- Modify: `build/assemble.mjs` — also write `dist/index.html`
- Modify: `package.json` — add `@tauri-apps/cli` devDep + tauri scripts

**Interfaces:**
- Produces: Rust commands `read_text`, `write_text`, `read_bytes`, `write_bytes`, `path_exists`, `list_dir`, `pick_folder` (consumed by Task 2's `tauriFs.js`)
- Produces: `dist/index.html` (served by Tauri as the frontend)

- [ ] **Step 1: Install Rust prerequisites (one-time setup)**

Run in a terminal (not inside this project):
```
winget install Rustlang.Rustup
```
Then close and reopen the terminal so `cargo` is on PATH. Verify:
```
cargo --version
```
Expected: `cargo 1.xx.x (...)` — any recent version is fine.

- [ ] **Step 2: Add `@tauri-apps/cli` to package.json and install**

Open `package.json`. Replace the `"devDependencies"` block and `"scripts"` block with:
```json
{
  "name": "html-site-editor",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build/assemble.mjs",
    "build:exe": "node build/build-exe.mjs",
    "test": "node --test",
    "test:e2e": "node tests/e2e/run.mjs",
    "test:e2e-server": "node tests/e2e/server.mjs",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "esbuild": "^0.24.0",
    "jsdom": "^25.0.1",
    "parse5": "^7.2.1",
    "postject": "^1.0.0-alpha.6"
  }
}
```
Then run:
```
npm install
```
Expected: `@tauri-apps/cli` appears in `node_modules/.bin/tauri`.

- [ ] **Step 3: Extend `build/assemble.mjs` to also output `dist/index.html`**

Open `build/assemble.mjs`. The current file is:
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

Replace it with:
```js
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
```

- [ ] **Step 4: Run the build and verify `dist/index.html` is created**

```
npm run build
```
Expected output:
```
Wrote editor.html (NNNNN bytes)
Wrote dist/index.html (NNNNN bytes)
```
Also verify `dist/index.html` exists:
```
ls dist/
```
Expected: `index.html` present.

- [ ] **Step 5: Create `src-tauri/Cargo.toml`**

Create the file at `src-tauri/Cargo.toml` with this exact content:
```toml
[package]
name = "html-site-editor"
version = "1.0.0"
edition = "2021"

[lib]
name = "html_site_editor_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 6: Create `src-tauri/build.rs`**

Create `src-tauri/build.rs`:
```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 7: Create `src-tauri/src/main.rs`**

Create `src-tauri/src/main.rs`:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    html_site_editor_lib::run()
}
```

The `windows_subsystem = "windows"` attribute hides the console window in release builds. In debug builds the console is visible (useful for `println!` debugging).

- [ ] **Step 8: Create `src-tauri/src/lib.rs` with all six file commands**

Create `src-tauri/src/lib.rs`:
```rust
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
struct DirEntryInfo {
    name: String,
    is_dir: bool,
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir,
        });
    }
    Ok(entries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            read_bytes,
            write_bytes,
            path_exists,
            list_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Note: `DirEntryInfo` fields use snake_case (`is_dir`). serde serializes them as `is_dir` in JSON. The JS side accesses `e.is_dir`. This is intentional — do not add `#[serde(rename_all = "camelCase")]`.

- [ ] **Step 9: Create `src-tauri/tauri.conf.json`**

Create `src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "HTML Site Editor",
  "version": "1.0.0",
  "identifier": "com.htmlsiteeditor.app",
  "build": {
    "beforeBuildCommand": "node build/assemble.mjs",
    "beforeDevCommand": "node build/assemble.mjs",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "HTML Site Editor",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Key points:
- `frontendDist: "../dist"` — relative to `src-tauri/`, points to the project's `dist/` directory
- `withGlobalTauri: true` — injects `window.__TAURI__.*` globals into the webview
- `csp: null` — disables CSP so blob: URLs for images/scripts in the editor iframe work
- `beforeDevCommand` — runs `assemble.mjs` once before `tauri dev` opens the window

- [ ] **Step 10: Create `src-tauri/capabilities/default.json`**

Create the `src-tauri/capabilities/` directory, then `src-tauri/capabilities/default.json`:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open"
  ]
}
```

Note: `"windows": ["main"]` refers to the first (and only) window defined in `tauri.conf.json`, which Tauri labels `"main"` by default. The custom commands (`read_text`, `write_text`, etc.) registered via `invoke_handler` don't need capability entries — they're available by default. Only built-in Tauri plugins need entries here.

- [ ] **Step 11: Create placeholder icons**

Tauri requires icon files to exist before building. Generate them from any PNG source image:
```
npm run tauri -- icon docs/shot-welcome.png
```
This reads `docs/shot-welcome.png` (already exists in the project) and writes the full icon set to `src-tauri/icons/`. Expected output: files including `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.icns` in `src-tauri/icons/`.

If `tauri icon` is not recognized, try:
```
npx @tauri-apps/cli icon docs/shot-welcome.png
```

- [ ] **Step 12: Verify the Tauri project compiles**

Run:
```
npm run tauri:dev
```

Tauri will:
1. Run `node build/assemble.mjs` (writes `dist/index.html`)
2. Download and compile Rust dependencies (first run takes 2–5 minutes)
3. Open a window titled "HTML Site Editor" showing the editor welcome screen

Expected: Window appears, showing the "Edit your website" welcome card with the "Open site folder" button. The "Open site folder" button click will open the OS file picker (we haven't wired it yet, but it should fall through to the browser codepath). Close the window to stop.

If compilation fails with a Rust error, check the error message — common issues:
- Missing `tauri-build` in `[build-dependencies]` → check `Cargo.toml`
- `capabilities/default.json` schema error → confirm the file content matches Step 10 exactly

- [ ] **Step 13: Run existing tests to confirm nothing is broken**

```
npm test
```
Expected: All tests pass (same count as before — no new tests in this task).

- [ ] **Step 14: Commit**

```
git add src-tauri/ dist/ build/assemble.mjs package.json package-lock.json
git commit -m "feat: add Tauri v2 project scaffold with Rust file commands"
```

---

### Task 2: `tauriFs.js` adapter + `app.js` Tauri integration

**Files:**
- Create: `src/tauriFs.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes (from Task 1): `window.__TAURI__.core.invoke` for Rust commands `read_text`, `write_text`, `read_bytes`, `write_bytes`, `path_exists`, `list_dir`; `window.__TAURI__.dialog.open` for folder picker; `window.__TAURI__.webview.getCurrentWebview().onDragDropEvent` for drag-drop
- Produces: `createTauriFs(rootPath)`, `createTauriSingleFileFs(filePath)`, `pickTauriFolder()` — consumed by the modified `app.js`

- [ ] **Step 1: Create `src/tauriFs.js`**

Create `src/tauriFs.js` with this exact content:
```js
// Tauri desktop fs adapter. Same interface as createFs() in fsAccess.js but backed
// by native Rust commands. Only call these functions when window.__TAURI__ is present.

function abs(rootPath, relPath) {
  // Rust std::fs accepts forward slashes on Windows; normalize to avoid mixing separators.
  const base = rootPath.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  return base + "/" + relPath;
}

export function createTauriFs(rootPath) {
  const name = rootPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const call = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

  return {
    rootHandle: {
      name,
      async *values() {
        const entries = await call("list_dir", { path: rootPath });
        for (const e of entries) {
          yield { kind: e.is_dir ? "directory" : "file", name: e.name };
        }
      },
    },
    async readText(relPath) {
      return call("read_text", { path: abs(rootPath, relPath) });
    },
    async readBytes(relPath) {
      const bytes = await call("read_bytes", { path: abs(rootPath, relPath) });
      return new Blob([new Uint8Array(bytes)]);
    },
    async writeText(relPath, text) {
      await call("write_text", { path: abs(rootPath, relPath), text });
    },
    async writeBytes(relPath, blob) {
      const buf = await (blob instanceof Blob ? blob : new Blob([blob])).arrayBuffer();
      await call("write_bytes", {
        path: abs(rootPath, relPath),
        bytes: Array.from(new Uint8Array(buf)),
      });
    },
    async exists(relPath) {
      return call("path_exists", { path: abs(rootPath, relPath) });
    },
    async uniqueName(dirPath, baseName) {
      const dot = baseName.lastIndexOf(".");
      const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
      const ext = dot > 0 ? baseName.slice(dot) : "";
      let nm = baseName, i = 0;
      while (await this.exists((dirPath ? dirPath + "/" : "") + nm)) {
        i++; nm = `${stem}-${i}${ext}`;
      }
      return nm;
    },
  };
}

// Wraps a single .html file as a minimal single-file fs.
// Used when the user drags a standalone .html file onto the window.
export function createTauriSingleFileFs(filePath) {
  const name = filePath.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const call = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
  return {
    rootHandle: {
      name,
      async *values() { yield { kind: "file", name }; },
    },
    async readText() {
      return call("read_text", { path: filePath });
    },
    async readBytes() {
      const bytes = await call("read_bytes", { path: filePath });
      return new Blob([new Uint8Array(bytes)]);
    },
    async writeText(_p, text) {
      await call("write_text", { path: filePath, text });
    },
    async writeBytes(_p, blob) {
      const buf = await (blob instanceof Blob ? blob : new Blob([blob])).arrayBuffer();
      await call("write_bytes", {
        path: filePath,
        bytes: Array.from(new Uint8Array(buf)),
      });
    },
    async exists(p) { return p === name; },
    async uniqueName(_dir, base) { return base; },
  };
}

export async function pickTauriFolder() {
  const result = await window.__TAURI__.dialog.open({ directory: true, multiple: false });
  if (!result) return null;
  const path = typeof result === "string" ? result : result[0];
  return createTauriFs(path);
}
```

- [ ] **Step 2: Modify `src/app.js` — add import and isTauri constant**

At the top of `src/app.js`, the current imports are:
```js
import { supported, pickRoot, createFs } from "./fsAccess.js";
import { createSession } from "./pages.js";
import { buildPreview } from "./assets.js";
import { wireEditor } from "./editor.js";
import { resolvePath, isHtml } from "./paths.js";
import { inServerMode, siteFromQuery, fetchSites, createServerFs } from "./serverFs.js";
```

Add the tauriFs import and the `isTauri` constant after the existing imports:
```js
import { supported, pickRoot, createFs } from "./fsAccess.js";
import { createSession } from "./pages.js";
import { buildPreview } from "./assets.js";
import { wireEditor } from "./editor.js";
import { resolvePath, isHtml } from "./paths.js";
import { inServerMode, siteFromQuery, fetchSites, createServerFs } from "./serverFs.js";
import { createTauriFs, createTauriSingleFileFs, pickTauriFolder } from "./tauriFs.js";

const isTauri = typeof window !== "undefined" && typeof window.__TAURI__ !== "undefined";
```

- [ ] **Step 3: Modify `bootApp()` in `src/app.js` to handle Tauri startup**

Find the block near the end of `bootApp()` that reads:
```js
  if (inServerMode()) {
    bootServerMode();
  } else if (!supported()) {
    els.pill.textContent = "Needs the launcher";
    els.pill.className = "pill warn";
    showToast("To edit in <b>this</b> browser, start the helper: double-click <code>start.cmd</code>. (Chrome/Edge can also open <code>editor.html</code> directly.)", true);
  }
```

Replace it with:
```js
  if (isTauri) {
    // Native file access via Tauri — no server or browser API needed.
  } else if (inServerMode()) {
    bootServerMode();
  } else if (!supported()) {
    els.pill.textContent = "Needs the launcher";
    els.pill.className = "pill warn";
    showToast("To edit in <b>this</b> browser, start the helper: double-click <code>start.cmd</code>. (Chrome/Edge can also open <code>editor.html</code> directly.)", true);
  }
```

- [ ] **Step 4: Modify `buildWelcome()` in `src/app.js` to hide browser hint in Tauri**

Find the `buildWelcome()` function. The last element before the button is:
```js
      h("p", { class: "hint", html: "In <b>Chrome/Edge</b> open this file directly. In <b>any</b> browser (Firefox, Safari, Brave…), start the helper with <code>start.cmd</code>." }),
```

Replace that line with:
```js
      isTauri ? null : h("p", { class: "hint", html: "In <b>Chrome/Edge</b> open this file directly. In <b>any</b> browser (Firefox, Safari, Brave…), start the helper with <code>start.cmd</code>." }),
```

- [ ] **Step 5: Modify `openFolder()` in `src/app.js` to use Tauri folder picker**

Find the `openFolder()` function. The current content is:
```js
async function openFolder() {
  if (inServerMode()) return showSitePicker();
  if (!supported()) {
    showToast("This browser can't save files directly. Start the helper — double-click <code>start.cmd</code> — and use the link it opens.", true);
    return;
  }
  try {
    rootHandle = await pickRoot();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    showToast("Couldn't open the folder: " + (err && err.message), true);
    return;
  }
  await startSession(createFs(rootHandle), rootHandle.name);
}
```

Replace it with:
```js
async function openFolder() {
  if (isTauri) {
    const tFs = await pickTauriFolder();
    if (!tFs) return; // user cancelled the picker
    await startSession(tFs, tFs.rootHandle.name);
    return;
  }
  if (inServerMode()) return showSitePicker();
  if (!supported()) {
    showToast("This browser can't save files directly. Start the helper — double-click <code>start.cmd</code> — and use the link it opens.", true);
    return;
  }
  try {
    rootHandle = await pickRoot();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    showToast("Couldn't open the folder: " + (err && err.message), true);
    return;
  }
  await startSession(createFs(rootHandle), rootHandle.name);
}
```

- [ ] **Step 6: Modify `installDragAndDrop()` in `src/app.js` to handle Tauri drag events**

Find the `installDragAndDrop()` function. The current content starts with:
```js
function installDragAndDrop() {
  let sitesCache = null;
  const overlay = h("div", { class: "drop-overlay", id: "dropOverlay" }, "Drop a site folder or .html file to edit it");
  document.body.append(overlay);
  let depth = 0;
  window.addEventListener("dragenter", ...
```

Replace the entire function with:
```js
function installDragAndDrop() {
  const overlay = h("div", { class: "drop-overlay", id: "dropOverlay" }, "Drop a site folder or .html file to edit it");
  document.body.append(overlay);

  if (isTauri) {
    // Tauri intercepts drag events before the webview sees them.
    // DragDropEvent types: "hover", "drop", "leave", "cancelled".
    window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(async (event) => {
      const type = event.payload.type;
      if (type === "hover") { overlay.classList.add("show"); return; }
      if (type === "leave" || type === "cancelled") { overlay.classList.remove("show"); return; }
      if (type !== "drop") return;
      overlay.classList.remove("show");
      const paths = event.payload.paths;
      if (!paths || !paths.length) return;
      const p = paths[0];
      const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
      if (/\.html?$/i.test(name)) {
        await startSession(createTauriSingleFileFs(p), name);
      } else {
        await startSession(createTauriFs(p), name);
      }
    });
    return;
  }

  // Browser (non-Tauri) drag-and-drop handlers below.
  let sitesCache = null;
  let depth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; overlay.classList.add("show"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => { e.preventDefault(); if (--depth <= 0) overlay.classList.remove("show"); });
  window.addEventListener("drop", async (e) => {
    e.preventDefault(); depth = 0; overlay.classList.remove("show");
    const item = e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items[0];
    if (!item) return;

    if (typeof item.getAsFileSystemHandle === "function") {
      let handle = null;
      try { handle = await item.getAsFileSystemHandle(); } catch {}
      if (handle && handle.kind === "directory") {
        if (handle.requestPermission) { try { await handle.requestPermission({ mode: "readwrite" }); } catch {} }
        await startSession(createFs(handle), handle.name);
        return;
      }
      if (handle && handle.kind === "file") {
        if (!/\.html?$/i.test(handle.name)) {
          showToast("Drop an <b>.html</b> file or a site folder.", true); return;
        }
        if (handle.requestPermission) { try { await handle.requestPermission({ mode: "readwrite" }); } catch {} }
        await startSession(createSingleFileFs(handle), handle.name);
        return;
      }
    }

    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry && entry.isDirectory) {
      if (!inServerMode()) {
        showToast("Folder drag works in <b>Chrome/Edge</b>. In other browsers, start the helper (<code>start.cmd</code>) and pick a site from the list.", true);
        return;
      }
      try {
        if (!sitesCache) sitesCache = (await fetchSites()).sites;
        const match = matchSite(entry.name, sitesCache);
        if (match) { await startSession(createServerFs(match), match); return; }
      } catch {}
      showToast("Couldn't find <b>" + escapeHtml(entry.name) + "</b> under the helper's folder. Move it there, or pick it from the list.", true);
      return;
    }
    if (entry && entry.isFile) {
      showToast(inServerMode()
        ? "Single-file drag needs <b>Chrome/Edge</b>. In Firefox, pick a site from the list instead."
        : "File drag works in <b>Chrome/Edge</b>. Open <code>editor.html</code> in Chrome/Edge to drag files.", true);
      return;
    }
    showToast("Drop a site folder or <code>.html</code> file. (Chrome/Edge: any folder; Firefox/Brave: use the helper and pick from the list.)", true);
  });
}
```

- [ ] **Step 7: Rebuild and verify existing tests still pass**

```
npm run build
npm test
```
Expected: Build succeeds; all tests pass.

- [ ] **Step 8: Test the Tauri app — open a folder**

```
npm run tauri:dev
```

In the window that opens:
1. Click **Open site folder**
2. Expected: a native Windows folder picker dialog opens
3. Select any folder containing an `.html` file (e.g., one of your existing sites)
4. Expected: the site loads in the editor, the top bar shows "Editing: [folder name]"
5. Click some text and edit it
6. Click **Save All**
7. Open the file on disk in a text editor and confirm the change was saved

If the folder picker doesn't appear, check the browser console (right-click the window → "Inspect" if Tauri dev mode has devtools enabled). A Tauri invoke error would appear there.

- [ ] **Step 9: Test the Tauri app — drag and drop a folder**

With the Tauri dev window open:
1. Open File Explorer and find a site folder
2. Drag it onto the Tauri window
3. Expected: the blue drop overlay appears on hover, then the site loads on drop
4. Verify editing and saving work

- [ ] **Step 10: Test the Tauri app — drag and drop a single .html file**

1. Find a standalone `.html` file in File Explorer
2. Drag it onto the Tauri window
3. Expected: the file loads in the editor
4. Edit text, Save All, open the file on disk to confirm change saved

- [ ] **Step 11: Commit**

```
git add src/tauriFs.js src/app.js
git commit -m "feat: add tauriFs adapter and wire Tauri open/drag-drop in app.js"
```

---

### Task 3: Icons + production build

**Files:**
- `src-tauri/icons/` — already generated in Task 1 Step 11; replace with a proper icon if desired
- No code changes; this task is build + verification

**Interfaces:**
- Consumes: everything from Tasks 1 and 2
- Produces: `src-tauri/target/release/HTML Site Editor.exe` — portable standalone app

- [ ] **Step 1: (Optional) Replace the placeholder icon with a better one**

If you have a 1024×1024 PNG icon you'd like to use:
```
npm run tauri -- icon path/to/your-icon.png
```
This overwrites `src-tauri/icons/` with the new icon set. Skip this step to keep the placeholder from Task 1.

- [ ] **Step 2: Run the production build**

```
npm run tauri:build
```

Tauri will:
1. Run `node build/assemble.mjs` (writes `dist/index.html`)
2. Compile the Rust backend in release mode
3. Bundle the frontend into the app
4. Output the executable

Expected output near the end:
```
    Finished `release` profile [optimized] target(s) in ...
    Bundling HTML Site Editor_1.0.0_x64-setup.exe
    Bundling HTML Site Editor_1.0.0_x64_en-US.msi
```

The portable `.exe` (not an installer) is at:
```
src-tauri/target/release/HTML Site Editor.exe
```
The installer variants (setup.exe, .msi) are at:
```
src-tauri/target/release/bundle/
```

- [ ] **Step 3: Test the portable .exe**

Navigate to `src-tauri/target/release/` and double-click `HTML Site Editor.exe`. Verify:
- [ ] Window opens with the welcome screen (no browser, no terminal)
- [ ] "Open site folder" → folder picker → site loads → editing works → Save All writes to disk
- [ ] Drag a site folder onto the window → site loads
- [ ] Drag a `.html` file onto the window → loads
- [ ] Edit text, save, open file in Notepad to confirm change persisted
- [ ] Replace an image, save, check file on disk updated
- [ ] Click a link within the site → navigates to that page in the editor
- [ ] Alt-click a link → prompt to change the URL appears
- [ ] Ctrl+S → Save All fires
- [ ] Close window → app exits (no crash)

- [ ] **Step 4: Verify the browser workflow still works**

Open `editor.html` (at the project root) in Chrome. Confirm:
- [ ] Welcome screen shows browser-specific hint ("In Chrome/Edge open this file directly…")
- [ ] "Open site folder" → browser's folder picker (not OS dialog) → site loads
- [ ] Drag-and-drop still works as before

- [ ] **Step 5: Add `dist/` and `src-tauri/target/` to `.gitignore`**

Open `.gitignore` and add these lines if not already present:
```
dist/
src-tauri/target/
```
The `dist/` directory is generated by the build; `src-tauri/target/` is Rust build output (~500 MB). Neither should be committed.

- [ ] **Step 6: Final test run**

```
npm test
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```
git add .gitignore
git commit -m "feat: add Tauri production build; exclude dist/ and src-tauri/target/ from git"
```

---

## Self-Review

**Spec coverage:**
- ✅ Thin Tauri shell around existing editor.html → Tasks 1–3
- ✅ `withGlobalTauri: true` → Task 1 Step 9 (`tauri.conf.json`)
- ✅ `frontendDist: "../dist"` + `assemble.mjs` outputs `dist/index.html` → Task 1 Steps 3–4, 9
- ✅ Custom Rust commands: read_text, write_text, read_bytes, write_bytes, path_exists, list_dir → Task 1 Step 8
- ✅ `tauri-plugin-dialog` for OS folder picker → Task 1 Step 5 (Cargo.toml), Task 2 Step 1 (pickTauriFolder)
- ✅ `createTauriFs(rootPath)` with full interface → Task 2 Step 1
- ✅ `rootHandle.values()` using `list_dir` → Task 2 Step 1
- ✅ `createTauriSingleFileFs(filePath)` → Task 2 Step 1
- ✅ `window.__TAURI__` detection in app.js → Task 2 Step 2
- ✅ Tauri folder picker wired to "Open site folder" button → Task 2 Step 5
- ✅ Tauri drag-drop via `onDragDropEvent` → Task 2 Step 6
- ✅ Folder drag → `createTauriFs`; `.html` file drag → `createTauriSingleFileFs` → Task 2 Step 6
- ✅ Browser welcome hint hidden in Tauri → Task 2 Step 4
- ✅ Existing browser workflow unchanged → Task 3 Step 4
- ✅ Window 1200×800, min 800×600 → Task 1 Step 9
- ✅ App icons → Task 1 Step 11, Task 3 Step 1
- ✅ Portable `.exe` with no installer → Task 3 Step 2
- ✅ `dist/` and `src-tauri/target/` in `.gitignore` → Task 3 Step 5
- ✅ All existing unit tests pass throughout → checked in Tasks 1 and 2
