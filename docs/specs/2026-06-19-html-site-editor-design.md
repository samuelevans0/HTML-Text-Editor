# HTML Site Editor — Design

**Date:** 2026-06-19
**Status:** Approved-pending-review
**Supersedes:** the existing site-specific `editor.html` (SportsCenter Landscaping)

## 1. Summary

A single, self-contained `editor.html` that lets a non-technical user open *any* static
HTML site folder in Chrome/Edge and edit it visually — text, images, and link targets —
then save changes **back into the real files** with surgically minimal diffs. Clicking an
in-site link loads that page into the editor too; **Save All** writes every page you
changed in one click; closing with unsaved edits warns you first.

It replaces the current tool, which only edits a hardcoded whitelist of CSS classes on one
specific site and bakes in business-specific logic (phone rewriting, fixed photo slots).

## 2. Goals / Non-goals

**Goals**
- Edit visible **text** on any element, with basic **bold/italic** and inline links preserved.
- Replace **images** (click or drag-drop a file).
- Edit **link targets** (the destination URL) as well as link labels.
- **Navigate** in-site links and edit linked pages within the same session.
- **Save to the actual files** (not download), writing every changed page + replaced images.
- **Minimal-diff** saves: bytes you didn't edit stay byte-for-byte identical.
- **Never corrupt a file** — refuse-and-warn beats guess-and-write.
- **Warn on unsaved changes** when closing/reloading.
- Zero install: one HTML file, opened in Chrome/Edge, works offline on local files.

**Non-goals (v1)**
- Structural editing (add/delete/reorder/duplicate elements or sections).
- Editing dynamic/SPA pages whose content is built by JavaScript at runtime.
- Editing arbitrary attributes beyond `href`/`src` (and `srcset` for image swaps).
- Cross-browser direct-save (Firefox/Safari lack the File System Access API). A clear
  message is shown; no download fallback in v1 (it can't support multi-page navigation
  anyway).
- Recompressing/resizing images (kept lossless and predictable; possible future toggle).

## 3. Primary user flow

1. **Open site folder** → `showDirectoryPicker({ mode: "readwrite" })`. The tool offers
   `index.html` as the starting page (or lets the user pick any `.html` in the folder).
2. The page renders faithfully: its own CSS/images are loaded from the folder; its own
   JavaScript is disabled in the edit view.
3. **Edit in place:**
   - Click text → type. `Ctrl/Cmd+B` bold, `Ctrl/Cmd+I` italic. `Enter` = line break
     (single-line elements suppress it).
   - Click an image → file picker; or drag a file onto it. Preview updates immediately.
   - Click a link → edit its label inline; a small popover shows/edits its destination URL.
4. **Click an in-site link** → the target page loads into the editor and becomes editable.
   A breadcrumb + Back control navigate visited pages. Edits on every visited page are held
   in memory.
5. **Save All** → writes every changed page back to its file (minimal-diff) and writes any
   replaced images. A toast reports what was written and any edits that had to be skipped.
6. **Unsaved-changes guard:** if any visited page is dirty, `beforeunload` prompts.

External links (`http(s)://`, `mailto:`, `tel:`, `sms:`) are not followed for editing; the
tool shows a brief notice and (for `http(s)`) offers to open them in a new tab.

## 4. Architecture

One distributable file (`editor.html`) with vendored `parse5` inlined. Authored as small
modules under `src/` and assembled into `editor.html` by a build/assembly step the **user
never runs** (the committed `editor.html` is ready to open).

### Components (each independently understandable + testable)

#### `htmlSource` — the minimal-diff engine (pure, no DOM/browser)
- `parse(originalText)` → parse5 tree **with `sourceCodeLocationInfo: true`**.
- `nodePathToRange(tree, path, kind)` → resolves a node-path to a source character range
  (inner-content range, or a specific attribute's range).
- `applyEdits(originalText, edits)` → applies non-overlapping splices **right-to-left** and
  returns new text. `edits` = `[{ range:[start,end], replacement, meta }]`.
- `verify(originalText, newText, edits)` → re-parse `newText`; confirm structure matches the
  original except at intended ranges; return ok / list of problems.
- **Inputs/outputs are strings + plain objects.** This is the riskiest code and the focus of
  unit testing. Depends only on `parse5`.

#### `fsAccess` — filesystem wrapper
- Holds the root `FileSystemDirectoryHandle`.
- `resolve(fromPath, href)` → normalized in-folder path (handles `./`, `../`, subfolders,
  strips `#`/`?`, maps a directory or trailing `/` to its `index.html`). Returns `null` for
  out-of-folder or non-local targets.
- `readText(path)`, `readBytes(path)`, `writeText(path, text)`, `writeBytes(path, blob)`.
- `exists(path)`, `uniqueName(dir, base)` for new image files.
- Depends on: File System Access API.

#### `assets` — preview fidelity
- Given a page DOM + its directory path, rewrite relative references to `blob:` URLs read
  from the folder: `<link rel=stylesheet href>`, `<img src>` and `srcset`, `<source src>`/
  `srcset`, `<video poster>`, inline `style="...url(...)"`, and (best-effort, one level)
  `url(...)` inside loaded stylesheet text.
- **Disables scripts** in the preview (`<script>` neutralized) — they remain untouched in
  the saved file because the engine only patches edited ranges.
- Tracks created blob URLs; revokes them on page switch/close.
- Depends on: `fsAccess`.

#### `editor` — in-iframe editing layer (same-origin srcdoc; host calls it directly)
- Marks editable text elements `contenteditable`; wires bold/italic, paste-as-plain-text,
  Enter handling, and input → dirty reporting.
- Image elements: click/drag to choose a replacement; updates preview; records the swap.
- Links: editable label + URL popover; records target changes.
- Intercepts link clicks: in-site → ask host to navigate; external → notice.
- Reports each change to the host as an **edit record keyed by the element's node-path**
  (computed identically to how parse5 enumerates nodes).
- Depends on: nothing outside the iframe except the host callback interface.

#### `pages` — multi-file session manager
- One record per visited path:
  `{ path, handle, originalText, tree, edits: Map<nodePath, EditRecord>, replacedImages: [], dirty }`.
- Switching pages preserves unsaved edits in memory; returning re-applies them to the
  rendered preview.
- `globalDirty()` = any record dirty. `dirtyPages()` for Save All.
- Depends on: `fsAccess`, `htmlSource`, `assets`.

#### `app` — shell / UI
- Top bar: Open folder, breadcrumb + Back, **Save All**, Discard (current page), status pill.
- Toasts, welcome screen, keyboard shortcuts (`Ctrl/Cmd+S` = Save All).
- `beforeunload` guard when `globalDirty()`.
- Orchestrates: open → load page → render → edit → navigate → save.

## 5. Minimal-diff save engine (detailed)

The core guarantee: **untouched bytes are never rewritten; an edit that can't be located
safely is skipped, not guessed.**

### Why parse5
parse5 implements the WHATWG HTML parsing algorithm (it's what jsdom uses, validated against
html5lib). It parses *the same way the browser does*, so the tree it builds — including
implied `<tbody>`, optional `</li>`/`</p>` closes, foster-parented nodes — lines up
node-for-node with the live DOM the user edits. With `sourceCodeLocationInfo`, every element
carries exact offsets: `startTag`, `endTag` (when present), `endOffset`, and an `attrs`
map of per-attribute ranges.

### Addressing an element
Each editable DOM element is addressed by its **node-path**: the sequence of child indices
from the document root, counting node types the same way parse5 enumerates them. Because both
the browser and parse5 follow the spec, the same path selects the same element in both trees.

### Producing edits (on Save, per dirty page)
For each `EditRecord`:
- **Text edit:** new inner content is sanitized (see §7) to a minimal allowed form. Compare
  normalized old vs new; if unchanged, drop the edit. Otherwise splice the range
  `[startTag.endOffset, endTag ? endTag.startOffset : element.endOffset)` with the new inner
  HTML.
- **Attribute edit (`href`/`src`):** replace the whole attribute token from `attrs[name]`
  (e.g. `href="old"`) with `name="newEscaped"`. Minimal and unambiguous.
- **Image replace:** see §9 — may produce an attribute edit (new src) and/or a file write,
  or just a file write (overwrite in place) with no HTML edit.

### Safety nets (in order)
1. **Resolve-and-verify:** at the resolved path, confirm the parse5 node's tag name equals
   the DOM element's tag name **and** a checksum of its original text content matches what was
   loaded. Mismatch → skip this edit, collect a warning.
2. **Non-overlap + right-to-left:** sort splices by start descending; assert no overlaps;
   apply. Offsets of earlier edits stay valid.
3. **Re-parse sanity:** re-parse the produced text; walk it against the original tree and
   confirm structure is identical except at intended node-paths. On catastrophic mismatch,
   **refuse to write that file**, keep its edits, warn.
4. **Write atomically per file:** `createWritable()` → write → close. On failure, keep the
   page dirty and report; never leave a half-written file (the API truncates on close, so we
   only close after a full successful write).

### Worst case
"Couldn't save edit X on page Y" — never a corrupted file.

## 6. Preview fidelity

Pages are rendered via the iframe (`srcdoc`, same-origin with the host). Relative asset
references are rewritten to `blob:` URLs sourced from the picked folder so the page looks
right. Scripts are disabled in the preview only. Blob URLs are tracked and revoked on page
switch to avoid leaks. Stylesheets are loaded as text, `url(...)` references inside them are
best-effort rewritten one level deep (covers typical `images/...`, web-font files).

## 7. Editing UX details

- **Editable text:** any element that directly contains non-whitespace text and is not a
  structural/script/style/interactive-control container. Practically: headings, paragraphs,
  list items, table cells, spans, links, captions, buttons' labels, etc. Determined by a
  generic rule (has direct text node; not in a skip-list like `script,style,svg,head`), not a
  per-site whitelist.
- **Sanitization on edit:** keep text and a small allowlist — `<br>`, `<b>/<strong>`,
  `<i>/<em>`, and existing `<a>` (with its href). Strip contenteditable cruft (`<div>`,
  inline styles, `style`/`class` mutations). Paste is coerced to plain text.
- **Single-line elements** (headings, table cells, link labels, etc.) suppress `Enter`.
- **Links:** label edits go through the text path; a popover edits the `href`. Changing an
  in-site `href` is allowed; the tool does not verify the target exists (just warns if it
  resolves outside the folder).

## 8. Navigation & multi-file session

- In-site link click → `fsAccess.resolve` → if a local `.html` exists, load it as a new (or
  existing) page record and render. Current page's edits stay in memory.
- Breadcrumb shows the path stack; Back returns to the previous page (edits preserved).
- **Save All** iterates `dirtyPages()`, runs the engine per page, writes changed files +
  replaced images, then marks saved pages clean. Reports a summary (saved N pages, M images;
  skipped K edits with reasons).
- Re-opening a page already in the session reuses its in-memory record (with edits), so you
  never lose work by navigating.

## 9. Image replacement rules

When the user replaces an image element's source:
1. Read the new file's bytes (unchanged — lossless).
2. Determine the current `src`'s resolved in-folder path.
3. **If that file path is referenced by exactly one element** across visited pages → overwrite
   it in place. **No HTML edit** (the `src` stays the same) → zero diff in the HTML file.
4. **If referenced by multiple elements** (or it's a brand-new image with no existing file) →
   write a **new** uniquely-named file in the same directory (`fsAccess.uniqueName`) and emit
   an attribute edit repointing only the clicked element's `src` (and clear a now-stale
   `srcset` if present on that element).
5. External/`data:` image sources → always treated as "new file" (write into an `images/`
   or sibling dir and repoint).

This guarantees images the user didn't touch are never altered.

## 10. Error handling & constraints

- **API unavailable** (non-Chromium, or blocked context): detect missing
  `window.showDirectoryPicker`; show a clear "use Chrome or Edge" message; disable editing.
- **Permission denied / lost:** writes fail gracefully; pages stay dirty; toast explains to
  re-open the folder and Allow.
- **Picked folder has no `.html`:** prompt to pick a different folder.
- **Edit can't be mapped / sanity check fails:** skip + warn (per §5), file untouched.
- **Large/binary files:** handled as bytes; only `.html` pages are parsed.
- **Navigating away mid-edit:** edits preserved in memory; nothing written until Save All.

## 11. Browser / environment

- Target: Chrome/Edge (Chromium) desktop, opened from `file://` or any local context that
  exposes the File System Access API. Works offline. No network needed at runtime (parse5 is
  inlined).
- If `file://` blocks the picker in some configuration, the same file works when served from
  any local static server; this is documented but not required.

## 12. Testing strategy

- **Unit (must-have), Node + a test runner:** exercise `htmlSource` directly. Fixtures of
  real-world-ish HTML: tables (implicit `<tbody>`), optional end tags (`<li>`,`<p>`),
  single-quoted attributes, entities (`&nbsp;`, `&amp;`), comments, void elements
  (`<img>`,`<br>`), duplicate identical text in multiple places, attributes with `>`/spaces.
  Assert: (a) an edit to one element changes **only** that range; (b) output is byte-identical
  elsewhere; (c) attribute edits touch only the attribute; (d) unmappable edits are reported,
  not applied; (e) the re-parse sanity check catches a deliberately corrupted splice.
- **Integration (should-have), Playwright/Puppeteer:** load a fixture folder, edit text +
  swap an image + change a link + navigate to a second page + Save All; assert the files on
  disk contain exactly the intended changes and nothing else; assert the unsaved-changes guard
  fires.
- A small `window.EDITOR_TEST` API (like the old `window.SCE`) exposes load/edit/save hooks
  for the integration tests.

## 13. File layout & build

```
HTML Text Editor/
  editor.html              # the distributable (parse5 + all modules inlined) — what the user opens
  src/
    htmlSource.js          # minimal-diff engine (uses global `parse5`)
    fsAccess.js
    assets.js
    editor.js
    pages.js
    app.js
    ui.css / inlined styles
  vendor/
    parse5.min.js          # vendored IIFE bundle exposing window.parse5
  build/
    assemble.mjs           # concatenates vendor + src into editor.html
  tests/
    htmlSource.test.mjs    # Node unit tests against src/htmlSource.js
    fixtures/...           # sample sites/pages
  package.json             # dev-only: parse5, test runner, esbuild, playwright (optional)
  docs/specs/2026-06-19-html-site-editor-design.md
```

- `editor.html` is committed ready-to-use; the build step is for maintainers only.
- The current `editor.html` (SportsCenter-specific) is replaced; saved aside as
  `editor.legacy.html` for reference if desired.

## 14. Out of scope / future

- Structural editing, undo/redo history across pages, find-and-replace, image
  resize/optimize toggle, a Firefox/Safari served-mode fallback, multi-folder/site switching
  without reopening.

## 15. Open risks

- **Parser/DOM divergence on pathological HTML:** mitigated by tag+checksum verification and
  re-parse sanity check (degrades to skip-and-warn, never corruption).
- **`file://` picker availability** varies by Chrome config; documented served-mode fallback.
- **Asset rewriting depth:** deeply nested `@import`/`url()` chains may not fully resolve; the
  preview can look slightly off without affecting saved output (we never rewrite assets in the
  saved file).
