# HTML Site Editor — Tauri Desktop App Design

## Goal

Wrap the existing browser-based HTML Site Editor in a Tauri v2 desktop shell so it runs as a portable, standalone `.exe` with its own window — no browser, no installer, no helper server needed.

## Architecture

A thin Tauri v2 Rust shell hosts the editor frontend in a native WebView2 window. The frontend is unchanged: `build/assemble.mjs` bundles `src/` into a single HTML file (`dist/index.html`) which Tauri serves via its custom protocol. A new `src/tauriFs.js` adapter implements the same `createFs()`-compatible interface the rest of the codebase already uses, backed by six custom Rust commands instead of the browser's File System Access API. `app.js` detects `window.__TAURI__` at startup and switches to the Tauri adapter automatically. All existing editing logic, tests, and the standalone `editor.html` browser workflow remain untouched.

## Tech Stack

- Tauri v2 (Rust backend, WebView2 frontend on Windows)
- `withGlobalTauri: true` — exposes `@tauri-apps/api` as `window.__TAURI__.*` globals, no JS bundler required
- `tauri-plugin-dialog` for the native OS folder picker
- Existing `build/assemble.mjs` build pipeline (extended to output `dist/index.html`)

---

## File Structure

### New files
| Path | Purpose |
|---|---|
| `src-tauri/src/main.rs` | Tauri app entry point (4 lines, calls lib) |
| `src-tauri/src/lib.rs` | Custom Rust commands + `run()` |
| `src-tauri/Cargo.toml` | Rust deps: tauri v2, tauri-plugin-dialog |
| `src-tauri/tauri.conf.json` | App config: window, frontendDist, withGlobalTauri |
| `src-tauri/capabilities/default.json` | Permission declarations for fs + dialog commands |
| `src-tauri/build.rs` | Standard Tauri build script (boilerplate) |
| `src-tauri/icons/` | App icon set (generated from a source PNG) |
| `src/tauriFs.js` | Tauri FS adapter — same interface as `createFs()` |

### Modified files
| Path | Change |
|---|---|
| `src/app.js` | Detect `window.__TAURI__`, use `tauriFs`, handle Tauri drag-drop event |
| `build/assemble.mjs` | Also output `dist/index.html` (Tauri frontend); keep `editor.html` at root |
| `package.json` | Add `@tauri-apps/cli` dev dep + `tauri` and `tauri:dev` npm scripts |

---

## Components

### Rust commands (`src-tauri/src/lib.rs`)

Six custom commands expose file operations to the frontend. All paths are absolute strings.

```rust
#[tauri::command] async fn read_text(path: String) -> Result<String, String>
#[tauri::command] async fn write_text(path: String, text: String) -> Result<(), String>
#[tauri::command] async fn read_bytes(path: String) -> Result<Vec<u8>, String>
#[tauri::command] async fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String>
#[tauri::command] async fn path_exists(path: String) -> Result<bool, String>
#[tauri::command] async fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String>
// pick_folder delegated to tauri-plugin-dialog (no custom command needed)
```

`DirEntryInfo` is a serializable struct `{ name: String, is_dir: bool }`.

Error handling: all commands map `std::io::Error` to `String` via `.map_err(|e| e.to_string())`. The JS adapter surfaces these as thrown errors.

### `src/tauriFs.js`

Implements `createTauriFs(rootPath: string)` — returns an object with the same shape as `createFs()` from `fsAccess.js`:

```js
{
  rootHandle: { name: string },   // last path segment of rootPath
  async readText(relPath),
  async readBytes(relPath),       // returns Blob
  async writeText(relPath, text),
  async writeBytes(relPath, blob),
  async exists(relPath),
  async uniqueName(dirPath, base),
}
```

All relative paths are joined to `rootPath` with a `/` separator before being passed to Rust commands. `readBytes` converts the `Uint8Array` returned by `read_bytes` into a `Blob` with the correct MIME type (using the existing `MIME` map from `assets.js` or a local copy).

Also exports `pickTauriFolder()`:
```js
export async function pickTauriFolder() {
  const path = await window.__TAURI__.dialog.open({ directory: true, multiple: false });
  if (!path) return null;
  return createTauriFs(path);
}
```

### `src/app.js` changes

**Startup detection:**
```js
const isTauri = typeof window !== 'undefined' && !!window.__TAURI__;
```

**Folder picker:** when `isTauri`, the "Open folder" button calls `pickTauriFolder()` instead of `pickRoot()` from `fsAccess.js`.

**Drag-drop:** when `isTauri`, skip the HTML5 `window.addEventListener('drop', ...)` handler and instead register:
```js
window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(async (event) => {
  if (event.payload.type !== 'drop') return;
  const paths = event.payload.paths; // string[]
  if (!paths.length) return;
  const p = paths[0];
  // If it's a directory, open as site folder; if .html file, open as single file
  await startSession(createTauriFs(p), p.split(/[\\/]/).pop());
});
```

Single-file `.html` drag: `createTauriFs` rooted at the file's parent directory, using the filename as the "site name". The existing `createSingleFileFs` codepath is bypassed for Tauri.

### Tauri config (`src-tauri/tauri.conf.json`)

```json
{
  "productName": "HTML Site Editor",
  "version": "1.0.0",
  "identifier": "com.htmlsiteeditor.app",
  "build": {
    "beforeBuildCommand": "node build/assemble.mjs",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [{
      "title": "HTML Site Editor",
      "width": 1200,
      "height": 800,
      "minWidth": 800,
      "minHeight": 600,
      "resizable": true
    }]
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "app"],
    "icon": ["icons/icon.png"]
  }
}
```

`frontendDist: "../dist"` — Tauri serves the `dist/` directory at `tauri://localhost`. The webview loads `dist/index.html` by default.

### Capabilities (`src-tauri/capabilities/default.json`)

Declares permissions for:
- `core:default` — base Tauri APIs
- `dialog:allow-open` — folder picker
- Custom commands: `read_text`, `write_text`, `read_bytes`, `write_bytes`, `path_exists`, `list_dir`

### `build/assemble.mjs` changes

Add a second output: after writing `editor.html` at root, also write `dist/index.html` with identical content. Tauri's `beforeBuildCommand` runs this automatically before every build.

---

## Build & Development

### Prerequisites (one-time)
```
winget install Rustlang.Rustup
rustup target add x86_64-pc-windows-msvc
npm install   # picks up @tauri-apps/cli
```

### Dev workflow
```
npm run tauri:dev    # hot-reload window; rebuilds editor HTML on JS changes
```

### Production build
```
npm run tauri:build  # runs assemble.mjs, then cargo tauri build
```

Output: `src-tauri/target/release/HTML Site Editor.exe` — portable, no install required. Copy anywhere and run.

### Existing browser workflow (unchanged)
```
node build/assemble.mjs   # still produces editor.html at root
```
Open `editor.html` in Chrome/Edge as before. `helper.exe` + `serverFs.js` remain functional for this path.

---

## What Goes Away (for Tauri app users)

The Tauri app doesn't need:
- `helper.exe` / `server.mjs` — no server needed; Tauri handles file access natively
- `serverFs.js` codepath — not used when `window.__TAURI__` is present
- Firefox/Brave workarounds — WebView2 is always available in the Tauri app

These files stay in the repo (browser workflow still works), they just aren't used by the app.

---

## Error Handling

- Rust commands return `Result<T, String>`; errors surface as rejected promises in JS and are caught by existing `showToast(..., true)` error handlers in `app.js`.
- Folder picker cancelled (returns `null`): `pickTauriFolder()` returns `null`, caller already handles null from `pickRoot()`.
- File not found / permission denied: Rust maps `std::io::Error` to string; the same toast shown for other fs errors appears.

---

## Testing

- Existing unit tests (`npm test`) are unaffected — they run in Node, don't touch Tauri APIs.
- Manual test checklist for the Tauri app:
  - Open folder via button → native OS picker appears → site loads in editor
  - Drag a site folder onto the window → site loads
  - Drag a standalone `.html` file → file loads
  - Edit text → Save → file on disk updated
  - Replace image → Save → file on disk updated
  - Window resize → editor reflows correctly
  - Close window → app exits cleanly
