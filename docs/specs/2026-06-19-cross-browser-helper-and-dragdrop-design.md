# Cross-Browser Local Helper + Drag-and-Drop — Design

**Date:** 2026-06-19
**Status:** Approved-pending-review
**Extends:** `2026-06-19-html-site-editor-design.md` (the base editor)

## 1. Summary

Make the HTML Site Editor **browser-agnostic** — fully usable (including in-place saving)
in Firefox, Mullvad, Brave, Safari, Vivaldi, LibreWolf, Chrome, Edge, etc. — by adding a
tiny **local helper server** that performs the file reads/writes. The editor talks to it
over `http://localhost`, so saving never depends on a browser-specific API. Also add
**drag-and-drop** of a site folder to open it.

The save engine and all its safety guarantees are **unchanged**: only the transport that
moves bytes to/from disk is new. This works because the base editor already abstracts the
filesystem behind one interface (`fsAccess.createFs`), proven by the in-memory test shim.

## 2. Goals / Non-goals

**Goals**
- In-place saving in **any** browser via the helper (the universal path).
- Keep Chrome/Edge's existing **no-install `file://`** mode (File System Access API).
- **Drag-and-drop** a site folder onto the window to open it.
- Zero new npm dependencies in the helper (Node built-ins only).
- Same minimal-diff, refuse-don't-corrupt safety everywhere.

**Non-goals (v1)**
- Dragging a *single file* (folders only).
- In non-Chromium browsers, opening folders that live **outside** the helper's base
  directory (such a drop shows a notice — move it under the base, or use Chrome).
- HTTPS / multi-user / remote access (localhost-only, single user).
- Bundling/packaging the helper as a binary (it's `node server.mjs` via a launcher).

## 3. How it's used

- **Any browser, in-place saving:** double-click **`start.cmd`** (Windows) / **`start.sh`**
  (macOS/Linux). It runs the helper and opens your browser to `http://localhost:<port>`.
  The editor shows your sites (the subfolders under the helper's base) — click one, or drag
  a folder in. Edit and **Save All** writes the real files.
- **Chrome/Edge, no install:** still open `editor.html` directly (`file://`). Click **Open
  site folder** or drag a folder in (writable handle). Save writes in place.

## 4. Architecture

### New/changed components

#### `server.mjs` — local helper (Node built-ins only)
- Launched as `node server.mjs [baseDir] [port]`. Defaults: `baseDir` = the parent of the
  tool directory (so sibling site folders are visible); `port` = 7777 (auto-increments if
  busy). **Binds to `127.0.0.1` only.**
- Serves the editor and a small file API rooted at `baseDir`:
  - `GET /` and `GET /editor.html` → the built `editor.html`.
  - `GET /__api/sites` → `{ base, sites:[name,…] }` (immediate subdirs of base containing
    at least one `.html`).
  - `GET /__api/list?site=S` → `{ files:[relpath,…] }` (recursive, under `base/S`).
  - `GET /__api/read?site=S&path=P` → file bytes (Content-Type by extension); 404 if absent.
  - `PUT /__api/write?site=S&path=P` → writes the request body to `base/S/P`
    (creates parent dirs); 200 on success.
- **Security:**
  - **Path traversal:** resolve to an absolute path and require it to stay within
    `base/site`; reject (403) otherwise. `site` must be a direct child of `base`.
  - **Origin guard:** for `/__api/*`, if an `Origin` header is present it must equal the
    server's own origin; otherwise 403. Prevents other websites in the browser from reading
    or writing your files through localhost. No permissive CORS headers are sent.
  - Localhost bind keeps it off the network.

#### `src/serverFs.js` — helper-backed filesystem
- `createServerFs(site)` returns the **same interface** as `fsAccess.createFs`:
  `rootHandle{name,values()}`, `readText`, `readBytes`, `writeText`, `writeBytes`,
  `exists`, `uniqueName`. Backed by `fetch` to `/__api/*` (same-origin).
- Caches the file list (`/__api/list`) so `exists`/`uniqueName`/`rootHandle.values()` are
  local; updates the cache on write. Reads fetch on demand.
- `inServerMode()` = `location.protocol` is `http:`/`https:`. `siteFromQuery()` reads
  `?site=`. `fetchSites()` → `/__api/sites`.

#### `src/app.js` — boot detection + drag-and-drop
- **Boot mode:**
  - **Server mode** (`http(s)://`, any browser): if `?site=` present →
    `startSession(createServerFs(site), site)`. Else show a **site picker** on the welcome
    screen (buttons from `/__api/sites`) plus the drag hint.
  - **`file://` with File System Access** (Chrome/Edge/Brave): current **Open** picker.
  - **`file://` without it** (Firefox/Mullvad direct): welcome explains "to edit in this
    browser, start the helper (`start.cmd`)".
- **Drag-and-drop** (window-level, with a drop overlay):
  1. If `DataTransferItem.getAsFileSystemHandle` exists (Chromium): get the directory
     handle → `requestPermission({mode:'readwrite'})` → `startSession(createFs(handle),
     name)`. Works in both `file://` and server mode; any folder is writable.
  2. Else use `webkitGetAsEntry()`: read the dropped folder's **name**. In server mode, if
     `/__api/sites` contains that name → `startSession(createServerFs(name), name)`
     (writable, in place). Otherwise → a clear notice: drop a folder that lives under the
     helper's base, or use Chrome/Edge (which can open any folder writable).

#### `start.cmd` / `start.sh` — launchers
- Run `node server.mjs` (from the tool dir) and open the default browser at the URL the
  server prints. Minimal; no arguments needed for the common case.

### Unchanged
`htmlSource`, `sanitize`, `editable`, `paths`, `assets`, `editor`, `pages`, and the build —
they consume the `fs` interface and don't care which backend provides it.

## 5. Data flow

Identical to the base editor; only `fs` differs:
`open → fs.readText(page) → DOMParser → stamp editIds → buildPreview(fs,…) → iframe →
wireEditor → edits → Save All → buildSave(text, edits) → fs.writeText/Bytes`.

In server mode, `fs.readText`/`writeText` are `fetch` calls to `/__api/*`; the helper does
the actual disk I/O.

## 6. Browser support matrix

| Browser | `file://` open + save | Helper (server) open + save | Drag-drop |
| --- | --- | --- | --- |
| Chrome/Edge/Brave/Vivaldi/Opera | ✅ (File System Access) | ✅ | ✅ writable handle |
| Firefox/Mullvad/LibreWolf | ❌ (use helper) | ✅ | ✅ if under base (else notice) |
| Safari | ❌ (use helper) | ✅ | ✅ if under base (else notice) |

The helper column is the universal, browser-agnostic path.

## 7. Error handling

- **Helper not running / fetch fails:** editor toast "Can't reach the local helper — is
  `start.cmd` running?"; edits stay in memory (not lost).
- **Write rejected (403 traversal/origin):** surfaced as a save error; page stays dirty.
- **Port busy:** server auto-increments and prints/opens the actual URL.
- **Drop of an out-of-base folder in a non-Chromium browser:** a clear notice (move it under
  the base, or use Chrome); nothing is opened.
- **`?site=` for a missing site:** show the picker with an error toast.

## 8. Testing

- **`tests/server.test.mjs` (Node, no browser):** start `server.mjs` on a temp base with a
  fixture site; assert `/__api/sites`, `list`, `read`, `write` round-trip; assert
  **path-traversal** (`../` escape) → 403 and **cross-origin write** (bad `Origin`) → 403.
- **`tests/e2e/server.mjs` (headless, Puppeteer):** start the helper, load
  `http://127.0.0.1:<port>/editor.html?site=demo`, drive edit + navigate + Save through the
  real `serverFs` path, and assert minimal-diff files on disk (this is the same code every
  browser runs in server mode). Best-effort: also run under Firefox if a binary is present.
- Existing unit + memory-fs e2e remain green.

## 9. File layout (additions)

```
HTML Text Editor/
  server.mjs                # local helper (Node built-ins only)
  start.cmd / start.sh      # double-click launchers
  src/serverFs.js           # helper-backed fs (same interface as createFs)
  src/app.js                # + boot detection + drag-and-drop
  tests/server.test.mjs
  tests/e2e/server.mjs
```

## 10. Open risks

- **Drag name-matching** (non-Chromium, server mode) keys off the folder name; duplicate
  site-folder names under the base could be ambiguous. Mitigation: match the first site of
  that name; otherwise show the picker. Acceptable for a single-user tool with unique names.
- **Localhost CSRF surface:** mitigated by the Origin guard + localhost bind; no CORS
  headers are emitted, so other origins can't read responses even if a request slips
  through.
