# HTML Site Editor

A visual editor for **any static HTML website**. Open your site folder, click to edit text,
swap images, and follow links to edit other pages — then **Save All** writes your changes
straight back into the real files, with surgically minimal diffs.

It runs three ways: as a **standalone Windows desktop app**, directly in **Chrome/Edge**, or in
**any browser** (Firefox/Safari/Brave/Mullvad/etc.) via a tiny local helper. This replaces the
old SportsCenter-specific editor (kept as `editor.legacy.html`).

## Ways to run it

### Desktop app (Windows) — standalone, no browser, no install
The simplest option. **`HTML Site Editor.exe`** is a single ~9 MB portable file (it uses the
WebView2 runtime already built into Windows 10/11 — no bundled browser). Copy it anywhere and
double-click it; no Node, no helper, no browser tab.

1. Double-click **`HTML Site Editor.exe`**.
2. Click **Open site folder** (or **drag a folder / `.html` file onto the window**) and pick
   your site.
3. Edit, then **Save All** — it writes straight to your real files via native OS file access.

Prebuilt artifacts live in **`app-build/`** (the portable `.exe` plus an NSIS `-setup.exe`
installer and an `.msi`). It's **unsigned**, so SmartScreen may warn the first time:
**"More info" → "Run anyway."** To rebuild it yourself, see [Building the desktop app](#building-the-desktop-app).

### Chrome / Edge — no install
1. Open **`editor.html`** in Chrome or Edge (double-click it).
2. Click **Open site folder** (or **drag a folder onto the window**) and pick your site.
3. Edit, then **Save All**.

### Any browser — the helper (Firefox, Safari, Brave, Mullvad, …)
Direct `file://` saving only works in Chromium browsers. For **any** browser, run the helper
(needs [Node.js](https://nodejs.org) installed):

1. Double-click **`start.cmd`** (Windows) or **`start.sh`** (macOS/Linux).
2. Your browser opens to `http://localhost:7777`. **Pick a site** from the list, or **drag a
   folder** onto the window.
3. Edit and **Save All** — the helper writes the real files. Identical in Firefox, Safari,
   Brave, Mullvad, Chrome, Edge, etc.

By default the helper shows the site folders sitting next to this tool. The helper is a tiny
Node server bound to `127.0.0.1` (localhost only), with path-traversal protection and an
Origin check so other websites can't reach your files.

### No Node.js? Two options

- **Install Node** (free) from <https://nodejs.org>, then use `start.cmd` / `start.sh`.
- **Windows standalone:** double-click **`helper.exe`** — a single file that runs the helper
  with no Node installed. It's **unsigned**, so Windows SmartScreen or your antivirus may warn
  you the first time: click **"More info" → "Run anyway."** That's expected for an unsigned
  local tool. If Node isn't found, `start.cmd` points you to this automatically.

`helper.exe` isn't committed to git (it's ~87 MB). Build or refresh it with `npm run build:exe`
(that step needs Node), or just copy the whole folder — the exe travels with it.

## Editing

- **Text** — click any text and type. `Ctrl/Cmd+B` bold, `Ctrl/Cmd+I` italic.
- **Images** — click an image (or drag a file onto it) to replace it.
- **Links** — *click* a link to open and edit that page; *Alt-click* a link to change where
  it points.
- **Save All** (or `Ctrl/Cmd+S`) writes every changed page in one go. You're warned if you
  try to close with unsaved changes.

## Safety guarantees

- **Minimal diffs.** Only the exact text/attributes you edited are rewritten; every other
  byte of every file stays identical — clean for git.
- **Never corrupts a file.** Edits are located using **parse5** (the same HTML parser the
  browser uses). Any edit that can't be located *and verified* is **skipped with a warning**
  rather than guessed, and a re-parse sanity check runs before anything is written.
- **Untouched files are never written.** Pages you only looked at, and images you didn't
  replace, are left exactly as they were.
- **Your site's own JavaScript is disabled in the editor view** (so it can't interfere) but
  is left completely untouched in the saved files.

## Browser support

| Browser | Open `editor.html` directly | Via the helper |
| --- | --- | --- |
| Chrome / Edge / Brave / Vivaldi / Opera | ✅ save in place | ✅ |
| Firefox / Mullvad / LibreWolf / Safari | preview only | ✅ save in place |

The helper column works in every browser and needs Node.js installed.

## Development

The single `editor.html` is **built** from the modules in `src/` (with `parse5` inlined).
You never need to build it to *use* it — the committed `editor.html` is ready to open.

```sh
npm install            # dev deps: parse5, esbuild, jsdom
npm run build          # bundle src/ + parse5 -> editor.html
npm run build:exe      # build the standalone helper.exe (Node SEA; gitignored)
npm test               # unit tests (engine, helpers, server, serverFs) via node:test
npm run test:e2e       # headless file:// flow (in-memory fs)
npm run test:e2e-server # headless server flow over http://localhost
```

### Building the desktop app

The desktop app is a thin [Tauri v2](https://tauri.app) shell in `src-tauri/` around the same
`src/` frontend. The build runs `assemble.mjs` to produce `dist/index.html`, then compiles a
native Rust host that serves it in a WebView2 window. `src/tauriFs.js` gives the frontend native
file access (the same interface as `fsAccess.js`), so no browser File System Access API or helper
server is needed.

One-time prerequisites:

```sh
winget install Rustlang.Rustup                 # Rust toolchain
winget install Microsoft.VisualStudio.2022.BuildTools `
  --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"   # MSVC linker + Windows SDK
npm install                                    # picks up @tauri-apps/cli
node build/make-icon.mjs && npm run tauri -- icon src-tauri/icon-source.png   # (re)generate icons
```

Then:

```sh
npm run tauri:dev      # dev window with hot frontend rebuild
npm run tauri:build    # portable .exe + installers
```

> ⚠️ **Apostrophe-in-path caveat (this repo).** This project lives under `…\Schmamel's Stuff\…`,
> and the Windows resource compiler (via `tauri-winres`) mis-escapes the apostrophe, failing the
> build with `RC2135: file not found …icon.ico`. A directory junction/symlink does **not** help
> (Rust canonicalizes it back to the real apostrophe path). **Build from a real copy on an
> apostrophe-free path:**
>
> ```powershell
> robocopy "<this folder>" "C:\hse-build" /E /XD "<this folder>\src-tauri\target" "<this folder>\.git"
> cd C:\hse-build; npm run tauri:build
> # artifacts: C:\hse-build\src-tauri\target\release\html-site-editor.exe (+ bundle\)
> ```
>
> The prebuilt files in `app-build/` were produced this way. Renaming the folder to remove the
> apostrophe would also fix it permanently.

### Layout

| Path | Responsibility |
| --- | --- |
| `src/htmlSource.js` | Minimal-diff engine: parse5 locations, ranges, splicing, sanity checks, `buildSave`. Pure. |
| `src/sanitize.js` | Edited element → minimal allowed inner HTML. |
| `src/editable.js` | Generic "is this editable text?" detection. |
| `src/paths.js` | In-folder path resolution. |
| `src/fsAccess.js` | File System Access directory backend (Chromium `file://`). |
| `src/serverFs.js` | Local-helper backend (`fetch` to the server) — same interface as `fsAccess`. |
| `src/tauriFs.js` | Tauri desktop backend (native Rust file commands) — same interface as `fsAccess`. |
| `src/assets.js` | Faithful preview via blob-URL asset rewriting. |
| `src/editor.js` | In-iframe editing layer (text/image/link). |
| `src/pages.js` | Multi-page session + Save All + image rules. |
| `src/app.js` | Chrome, boot-mode detection, open/load/navigate/save, drag-and-drop. |
| `server.mjs` | The local helper (Node built-ins only). |
| `start.cmd` / `start.sh` | Double-click launchers for the helper. |
| `build/assemble.mjs` | Bundles everything into `editor.html` (and `dist/index.html` for Tauri). |
| `build/make-icon.mjs` | Generates the square app-icon source PNG (pure Node, no deps). |
| `src-tauri/` | Tauri v2 desktop shell: Rust file commands (`src/lib.rs`), window config, capabilities. |
| `tests/` | Unit tests, headless integration tests, and a demo fixture site. |

See `docs/specs/` and `docs/plans/` for the design and implementation plans.
