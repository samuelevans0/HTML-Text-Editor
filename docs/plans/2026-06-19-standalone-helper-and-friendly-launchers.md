# Standalone Helper + Friendly Launchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a friendly message when Node is missing, and ship a no-Node `helper.exe` (Windows) built via Node SEA.

**Architecture:** `start()` gains an `editorPath` option so a packaged binary can serve the `editor.html` sitting next to it. A SEA entry (`build/sea-main.mjs`) computes paths from `process.execPath`; `build/build-exe.mjs` bundles it, generates a SEA blob, and injects it into a copy of `node.exe` via postject. Launchers detect Node and degrade to a clear message.

**Tech Stack:** Node SEA (`--experimental-sea-config`, `node:sea`), `postject` (blob injection), `esbuild` (bundle to CJS), Node built-ins.

## Global Constraints

- Helper uses **Node built-ins only** at runtime; the build adds `postject` (dev only).
- `helper.exe` is **gitignored** (~87 MB), regenerable via `npm run build:exe`.
- No change to the editor or save engine.
- The exe is **unsigned**; launchers must warn that SmartScreen/antivirus may flag it.
- SEA builds for the **host OS** only (Windows here).
- No `Co-Authored-By: Claude` trailer in commits.

---

## File Structure

```
HTML Text Editor/
  server.mjs            # MODIFY: start({ ..., editorPath })
  start.cmd             # MODIFY: Node detection + friendly message
  start.sh              # MODIFY: Node detection + friendly message
  build/sea-main.mjs    # NEW: SEA entry (paths from process.execPath)
  build/build-exe.mjs   # NEW: builds helper.exe
  .gitignore            # MODIFY: ignore helper.exe + build/sea-*
  package.json          # MODIFY: build:exe script + postject devDep
  tests/server.test.mjs # MODIFY: editorPath test
```

---

### Task 1: `server.mjs` — `editorPath` option

**Files:**
- Modify: `HTML Text Editor/server.mjs`
- Test: `HTML Text Editor/tests/server.test.mjs`

**Interfaces:**
- `start({ base, port=7777, open=false, editorPath })` — `editorPath` (absolute) overrides the
  file served at `/` and `/editor.html`. Defaults to the import-meta-relative
  `join(TOOL_DIR, "editor.html")`, so existing callers/tests are unchanged.
- `makeHandler(BASE, port, editorPath)` serves `editorPath`.

- [ ] **Step 1: Add the failing test** to `tests/server.test.mjs`

```js
import { writeFile as wf, mkdtemp as md } from "node:fs/promises";

test("editorPath overrides the served editor file", async () => {
  const dir = await md(join(tmpdir(), "hse-ep-"));
  await wf(join(dir, "custom.html"), "<!DOCTYPE html><title>CUSTOM-EDITOR</title>");
  const r = await start({ base: dir, port: 0, open: false, editorPath: join(dir, "custom.html") });
  try {
    const res = await fetch(`http://127.0.0.1:${r.port}/editor.html`);
    assert.match(await res.text(), /CUSTOM-EDITOR/);
  } finally { r.server.close(); }
});
```

(Add `import { tmpdir } from "node:os";` if not already present — it is, from the existing file.)

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/server.test.mjs`
Expected: FAIL (served file is the real editor.html, not CUSTOM-EDITOR).

- [ ] **Step 3: Implement.** In `server.mjs`, change the handler factory signature and the
editor route, and thread `editorPath` through `start`.

Replace `function makeHandler(BASE, port) {` with:
```js
function makeHandler(BASE, port, editorPath) {
```

Replace the editor-serving line:
```js
        return send(200, await readFile(join(TOOL_DIR, "editor.html")), "text/html; charset=utf-8");
```
with:
```js
        return send(200, await readFile(editorPath), "text/html; charset=utf-8");
```

In `start(...)`, change the signature and the `makeHandler` call:
```js
export function start({ base, port = 7777, open = false, editorPath = join(TOOL_DIR, "editor.html") } = {}) {
```
```js
        server.on("request", makeHandler(BASE, actual, editorPath));
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/server.test.mjs`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add server.mjs tests/server.test.mjs && git commit -m "feat(helper): start() accepts editorPath for packaged binaries"
```

---

### Task 2: Friendly launchers

**Files:**
- Modify: `HTML Text Editor/start.cmd`
- Modify: `HTML Text Editor/start.sh`

**Interfaces:** none (shell scripts).

- [ ] **Step 1: Rewrite `start.cmd`**

```bat
@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  echo Starting the HTML Site Editor helper...
  echo (Leave this window open while you edit. Close it or press Ctrl+C to stop.)
  node server.mjs
) else (
  echo ============================================================
  echo  Node.js was not found on this computer.
  echo ============================================================
  echo.
  echo  Option A ^(recommended^): install Node.js - it's free - from
  echo      https://nodejs.org
  echo  then double-click this file again.
  echo.
  if exist "%~dp0helper.exe" (
    echo  Option B: double-click  helper.exe  in this folder.
    echo      It's the standalone version and needs no Node.
    echo      It is unsigned, so Windows SmartScreen or your antivirus
    echo      may warn you - click "More info" then "Run anyway".
    echo      That warning is expected.
    echo.
  )
  pause
)
```

- [ ] **Step 2: Rewrite `start.sh`**

```sh
#!/bin/sh
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  echo "Starting the HTML Site Editor helper..."
  echo "(Leave this window open while you edit. Press Ctrl+C to stop.)"
  node server.mjs
else
  echo "============================================================"
  echo " Node.js was not found on this computer."
  echo "============================================================"
  echo
  echo " Install Node.js (free) from https://nodejs.org,"
  echo " then run this again."
  echo
  echo " (On macOS/Linux there's no prebuilt standalone binary -"
  echo "  installing Node, or just using Chrome/Edge, are the options.)"
  echo
  printf "Press Enter to close..."
  read _
fi
```

- [ ] **Step 3: Verify the Node-present path still boots** (regression)

Run: `NO_OPEN=1 node server.mjs "tests/fixtures" 8131 & sleep 1 && curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8131/editor.html ; kill %1`
Expected: prints `200`. (Confirms `server.mjs` itself is unbroken; the launcher just wraps it.)

- [ ] **Step 4: Commit**

```bash
git add start.cmd start.sh && git commit -m "feat: friendly launchers when Node is missing"
```

---

### Task 3: SEA build — `helper.exe`

**Files:**
- Create: `HTML Text Editor/build/sea-main.mjs`
- Create: `HTML Text Editor/build/build-exe.mjs`
- Modify: `HTML Text Editor/package.json` (script + postject devDep)
- Modify: `HTML Text Editor/.gitignore`

**Interfaces:**
- `npm run build:exe` → produces `helper.exe` (win) / `helper` (posix) beside `editor.html`.
- `build/sea-main.mjs` is the binary's entry: serves the `editor.html` next to the exe, base =
  the exe's parent folder, opens the browser.

- [ ] **Step 1: Install postject (dev)**

Run: `npm install --save-dev postject --no-audit --no-fund --loglevel=error`
Expected: postject added under devDependencies.

- [ ] **Step 2: Create `build/sea-main.mjs`**

```js
// Entry baked into helper.exe. Finds editor.html next to the executable.
import { start } from "../server.mjs";
import { dirname, join } from "node:path";

const exeDir = dirname(process.execPath);
const base = join(exeDir, "..");
const editorPath = join(exeDir, "editor.html");
const port = Number(process.env.PORT || 7777);
const { url, base: b } = await start({ base, port, open: true, editorPath });
console.log(`HTML Site Editor helper serving ${b}\n  -> ${url}\nClose this window to stop.`);
```

- [ ] **Step 3: Create `build/build-exe.mjs`**

```js
import { build as esbuild } from "esbuild";
import { inject } from "postject";
import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (p) => join(root, p);

// 1. ensure editor.html is built
execFileSync(process.execPath, [out("build/assemble.mjs")], { stdio: "inherit" });

// 2. bundle the SEA entry (server uses only node builtins -> nothing external pulled in)
await esbuild({
  entryPoints: [out("build/sea-main.mjs")],
  bundle: true, platform: "node", format: "cjs", target: "node20",
  outfile: out("build/sea-bundle.cjs"),
});

// 3. SEA config + blob
writeFileSync(out("build/sea-config.json"), JSON.stringify({
  main: "build/sea-bundle.cjs", output: "build/sea-prep.blob", disableExperimentalSEAWarning: true,
}));
execFileSync(process.execPath, ["--experimental-sea-config", out("build/sea-config.json")],
  { stdio: "inherit", cwd: root });

// 4. copy the node binary -> helper(.exe)
const exeName = process.platform === "win32" ? "helper.exe" : "helper";
const exePath = out(exeName);
copyFileSync(process.execPath, exePath);

// 5. inject the blob
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const opts = { sentinelFuse: fuse };
if (process.platform === "darwin") opts.machoSegmentName = "NODE_SEA";
await inject(exePath, "NODE_SEA_BLOB", readFileSync(out("build/sea-prep.blob")), opts);

// 6. cleanup temp artifacts
for (const f of ["build/sea-bundle.cjs", "build/sea-prep.blob", "build/sea-config.json"]) {
  try { rmSync(out(f)); } catch {}
}
console.log(`Built ${exeName} (${(statSync(exePath).size / 1048576).toFixed(0)} MB)`);
```

- [ ] **Step 4: Add script to `package.json`** (after `build`)

```json
    "build": "node build/assemble.mjs",
    "build:exe": "node build/build-exe.mjs",
```

- [ ] **Step 5: Update `.gitignore`** — append:

```
helper.exe
helper
build/sea-bundle.cjs
build/sea-prep.blob
build/sea-config.json
```

- [ ] **Step 6: Build the binary**

Run: `npm run build:exe`
Expected: prints `Built helper.exe (NN MB)` with NN > 40.

- [ ] **Step 7: Runtime smoke — the exe serves with no reference to Node**

Run (PowerShell):
```powershell
$env:NO_OPEN="1"; $env:PORT="8144"
$p = Start-Process -FilePath ".\helper.exe" -PassThru -WindowStyle Hidden
Start-Sleep 2
(Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8144/editor.html").StatusCode
Stop-Process -Id $p.Id -Force
```
Expected: `200`. (If antivirus quarantines the unsigned exe, note it — the build is still verified by Step 6.)

- [ ] **Step 8: Commit** (the exe itself is gitignored)

```bash
git add build/sea-main.mjs build/build-exe.mjs package.json package-lock.json .gitignore && git commit -m "feat: build a standalone no-Node helper.exe via Node SEA"
```

---

### Task 4: Docs + final verification

**Files:**
- Modify: `HTML Text Editor/README.md`

- [ ] **Step 1: Update `README.md`** — under the helper section, add:

```markdown
### No Node.js? Two options

- **Install Node** (free) from <https://nodejs.org>, then use `start.cmd` / `start.sh`.
- **Windows standalone:** double-click **`helper.exe`** — a single file that runs the helper
  with no Node installed. It's **unsigned**, so Windows SmartScreen or your antivirus may warn
  you the first time: click **"More info" → "Run anyway."** That's expected for an unsigned
  local tool.

`helper.exe` isn't committed to git (it's ~87 MB). Build/refresh it with `npm run build:exe`
(needs Node), or copy the whole folder — the exe travels with it.
```

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: all unit tests PASS (incl. the editorPath test).

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "docs: document helper.exe and the no-Node options"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** friendly launchers (Task 2), `editorPath` refactor (Task 1), SEA build +
  gitignore + script + postject (Task 3), runtime smoke (Task 3 Step 7), docs (Task 4). ✔
- **Placeholder scan:** all steps contain complete code/commands; no "handle edge cases"/TBD. ✔
- **Type/interface consistency:** `start({ …, editorPath })` default `join(TOOL_DIR,
  "editor.html")` matches the `makeHandler(BASE, port, editorPath)` consumer and the
  `sea-main.mjs` caller; fuse string identical between build and (implicit) SEA config. ✔
- **Watch during execution:** Node SEA on Windows injects into a *signed* `node.exe`; the
  resulting `helper.exe` has an invalidated signature (hence the unsigned warnings) but runs.
  If `postject`'s programmatic `inject` import path differs by version, fall back to its CLI
  (`node node_modules/postject/dist/cli.js helper.exe NODE_SEA_BLOB build/sea-prep.blob
  --sentinel-fuse <fuse>`). If the sandbox blocks running the unsigned exe in Step 7, the build
  (Step 6) still proves the artifact; note the AV behavior rather than treating it as a code bug.
```
