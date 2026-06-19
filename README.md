# HTML Site Editor

A single-file visual editor for **any static HTML website**. Open your site folder in
Chrome or Edge, click to edit text, swap images, and follow links to edit other pages —
then **Save All** writes your changes straight back into the real files, with surgically
minimal diffs.

This replaces the old SportsCenter-specific editor (kept as `editor.legacy.html` for
reference).

## Using it

1. Open **`editor.html`** in **Chrome** or **Edge** (double-click it).
2. Click **Open site folder** and pick the folder that holds your site (the one with
   `index.html`). Click **Allow** when asked for read/write access.
3. Edit:
   - **Text** — click any text and type. `Ctrl/Cmd+B` bold, `Ctrl/Cmd+I` italic.
   - **Images** — click an image (or drag a file onto it) to replace it.
   - **Links** — *click* a link to open and edit that page; *Alt-click* a link to change
     where it points.
4. Click **Save All** (or `Ctrl/Cmd+S`). Only the bits you changed are written. You'll be
   warned if you try to close with unsaved changes.

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
- Replacing an image used in only one place overwrites that file in place (no HTML change);
  if the same image is used in several places, a new file is written and only the image you
  clicked is repointed.

## Requirements

- A Chromium browser (Chrome, Edge, Brave, Opera) — it uses the File System Access API to
  read and write your files directly. Firefox/Safari don't support direct saving.
- Works fully offline. Nothing is uploaded.

## Development

The single `editor.html` is **built** from the modules in `src/` (with `parse5` inlined).
You never need to build it to *use* it — the committed `editor.html` is ready to open.

```sh
npm install        # dev deps: parse5, esbuild, jsdom
npm run build      # bundle src/ + parse5 -> editor.html
npm test           # unit tests (engine + helpers) via node:test
npm run test:e2e   # headless Puppeteer integration test (uses the parent Websites/ puppeteer)
```

### Layout

| Path | Responsibility |
| --- | --- |
| `src/htmlSource.js` | The minimal-diff engine: parse5 source locations, range resolution, splicing, sanity checks, `buildSave`. Pure (no DOM). |
| `src/sanitize.js` | Edited element → minimal allowed inner HTML. |
| `src/editable.js` | Generic "is this editable text?" detection. |
| `src/paths.js` | In-folder path resolution. |
| `src/fsAccess.js` | File System Access directory wrapper. |
| `src/assets.js` | Faithful preview via blob-URL asset rewriting. |
| `src/editor.js` | In-iframe editing layer (text/image/link). |
| `src/pages.js` | Multi-page session + Save All + image rules. |
| `src/app.js` | Chrome, open/load/navigate/save orchestration. |
| `build/assemble.mjs` | Bundles everything into `editor.html`. |
| `tests/` | Unit tests, headless integration test, and a demo fixture site. |

See `docs/specs/` and `docs/plans/` for the design and implementation plan.
