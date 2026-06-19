# Standalone Helper + Friendly Launchers — Design

**Date:** 2026-06-19
**Status:** Approved-pending-review
**Extends:** `2026-06-19-cross-browser-helper-and-dragdrop-design.md`

## 1. Summary

When someone without Node.js runs the helper launcher today, they get a cryptic OS error
(`'node' is not recognized` / `node: command not found`). Fix that two ways:

1. **Friendly launchers** — `start.cmd`/`start.sh` detect Node and, if it's missing, print a
   clear message offering either installing Node or running a standalone binary, and keep the
   window open.
2. **Standalone `helper.exe` (Windows)** — a single executable (built with Node SEA) that runs
   the helper with **no Node installed**. Built via `npm run build:exe`, kept out of git
   (gitignored), but built so it physically sits beside `editor.html`.

Chromium users are unaffected — they never needed Node and still open `editor.html` directly.

## 2. Goals / Non-goals

**Goals**
- A clear, actionable message when Node is missing (not a raw OS error).
- A working no-Node `helper.exe` on Windows, with honest unsigned-binary warnings.
- Keep the git repo light (the ~87 MB exe is gitignored, regenerable).
- No change to the editor or save engine.

**Non-goals (v1)**
- macOS/Linux prebuilt binaries (SEA builds for the OS it runs on; documented as
  `npm run build:exe` on that OS). The user is on Windows.
- Code-signing the exe (it stays unsigned; the launchers warn about it).
- Committing the binary to git.
- Auto-installing Node.

## 3. Components

#### `start.cmd` / `start.sh` (friendly)
- Detect Node: `where node` (cmd) / `command -v node` (sh).
- If found → run `node server.mjs` (unchanged).
- If not found → print:
  - *Node.js wasn't found.*
  - *Option A: install it free from https://nodejs.org, then run this again.*
  - *Option B (only shown if `helper.exe` exists): double-click `helper.exe` — the standalone
    version, no Node needed. It's unsigned, so Windows SmartScreen / your antivirus may warn
    you: click "More info" → "Run anyway." That's expected.*
  - Keep the window open (`pause` / read).

#### `server.mjs` (tiny refactor)
- `start({ base, port, open, editorPath })` — new optional `editorPath` (absolute path to the
  `editor.html` to serve). Defaults to the existing import-meta-relative path, so current
  callers/tests are unchanged. `makeHandler` serves `editorPath`.

#### `build/sea-main.mjs` (SEA entry)
- Imports `start` from `server.mjs`. Computes, from `process.execPath`:
  `exeDir = dirname(process.execPath)`, `base = join(exeDir, "..")`,
  `editorPath = join(exeDir, "editor.html")`. Calls
  `start({ base, port: env.PORT||7777, open: true, editorPath })` and prints the URL.

#### `build/build-exe.mjs` (`npm run build:exe`)
1. Ensure `editor.html` is built (run the normal build first).
2. esbuild-bundle `build/sea-main.mjs` → `build/sea-bundle.cjs` (`platform:node`,
   `format:cjs`, `bundle:true`). server.mjs uses only Node built-ins, so nothing external is
   pulled in.
3. Write `build/sea-config.json`:
   `{ "main": "build/sea-bundle.cjs", "output": "build/sea-prep.blob", "disableExperimentalSEAWarning": true }`.
4. `node --experimental-sea-config build/sea-config.json` → blob.
5. Copy `process.execPath` (node.exe) → `helper.exe`.
6. `postject helper.exe NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`.
7. Clean up `build/sea-*.{cjs,blob,json}`.
- `postject` added as a dev dependency. Cross-OS note printed if not win32 (still produces a
  binary for the host OS).

#### `.gitignore`
- Add `helper.exe` and `build/sea-*` so the binary and SEA temp artifacts are never committed.

## 4. Behavior / data flow

`helper.exe` (double-clicked) → SEA entry → `start()` with `editorPath` next to the exe and
`base` = the exe's parent folder → serves the editor + file API exactly like `node server.mjs`.
Identical runtime behavior; only the launch mechanism differs.

## 5. Error handling

- **Node missing:** friendly message (above); window stays open.
- **`helper.exe` missing but referenced:** the launcher only mentions Option B when
  `helper.exe` exists, so there's no dead pointer.
- **Antivirus/SmartScreen on the unsigned exe:** documented; the launcher tells the user the
  warning is expected and how to proceed.
- **`build:exe` without `postject`/SEA support:** the script fails loudly with a one-line
  reason; the friendly launchers and `node server.mjs` path are unaffected.

## 6. Testing

- **Unit (existing):** `server.test.mjs` still passes — the `editorPath` default keeps current
  behavior; add one test that `start({ …, editorPath })` serves the given file.
- **Build smoke:** run `npm run build:exe`; assert `helper.exe` exists and is non-trivial in
  size (> 40 MB).
- **Runtime smoke (best-effort):** spawn `helper.exe` with a test base + `PORT`, fetch
  `/editor.html` → 200, then kill it. If the environment's antivirus quarantines the unsigned
  exe, note it — the SEA build itself is still verified.

## 7. File layout (additions)

```
HTML Text Editor/
  start.cmd / start.sh      # MODIFY: Node detection + friendly message
  server.mjs                # MODIFY: start() gains editorPath
  build/sea-main.mjs        # NEW: SEA entry
  build/build-exe.mjs       # NEW: builds helper.exe
  helper.exe                # BUILT, gitignored (~87 MB)
  .gitignore                # MODIFY: ignore helper.exe + build/sea-*
  package.json              # MODIFY: build:exe script + postject devDep
```

## 8. Open risks

- **Unsigned-binary friction** is inherent; mitigated by clear launcher messaging.
- **Antivirus may block running the exe** even on the user's machine; the message sets
  expectations, and `node server.mjs` remains the friction-free path for anyone with Node.
- **SEA is marked experimental**; pinned fuse string + `disableExperimentalSEAWarning` keep it
  stable, and a build failure degrades gracefully (launchers + Node path still work).
