import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSource, nodeText, innerRange, attrToken, applySplices, sanityCheck, buildSave,
} from "../src/htmlSource.js";

const DOC = (body) =>
  `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

function editIdOf(html, tag, nth = 0) {
  const { byEditId } = parseSource(html);
  const matches = [...byEditId.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, n]) => n.tagName === tag);
  return matches[nth][0];
}

// ---------- Task 2: parse + preorder editIds ----------

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

// ---------- Task 3: inner range + attribute range ----------

test("innerRange covers inner content for closed element", () => {
  const html = `<!DOCTYPE html><html><body><h1>Hello</h1></body></html>`;
  const { byEditId } = parseSource(html);
  const h1 = [...byEditId.values()].find((n) => n.tagName === "h1");
  const [s, e] = innerRange(h1);
  assert.equal(html.slice(s, e), "Hello");
});

test("innerRange handles optional end tag (li auto-closed)", () => {
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

// ---------- Task 4: splice application ----------

test("applySplices replaces only given ranges, rest byte-identical", () => {
  const text = "AAA[1]BBB[2]CCC";
  const out = applySplices(text, [
    { range: [3, 6], replacement: "(one)" },
    { range: [9, 12], replacement: "(two)" },
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

// ---------- Task 5: structural sanity check ----------

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

test("sanityCheck with edit ranges allows inline elements added inside the edit", () => {
  const a = `<!DOCTYPE html><html><body><p>hello world</p><p>after</p></body></html>`;
  const b = `<!DOCTYPE html><html><body><p>hello<br>world <b>x</b></p><p>after</p></body></html>`;
  // The first <p> inner range in `a` is "hello world".
  const range = [a.indexOf("hello world"), a.indexOf("hello world") + "hello world".length];
  assert.equal(sanityCheck(a, b, [{ range, replacement: "hello<br>world <b>x</b>" }]).ok, true);
});

test("sanityCheck with edit ranges still catches structure changed outside the edit", () => {
  const a = `<!DOCTYPE html><html><body><p>aaa</p><p>bbb</p></body></html>`;
  const bad = `<!DOCTYPE html><html><body><p>aaa</p></body></html>`; // 2nd <p> vanished
  const range = [a.indexOf("aaa"), a.indexOf("aaa") + 3];
  assert.equal(sanityCheck(a, bad, [{ range, replacement: "aaa" }]).ok, false);
});

// ---------- Task 6: buildSave orchestration ----------

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

test("buildSave applies a text edit that adds inline formatting (br/bold)", () => {
  const html = DOC(`<p>hello world</p><p>after</p>`);
  const id = editIdOf(html, "p");
  const r = buildSave(html, [
    { editId: id, kind: "text", originalContent: "hello world", replacement: "hello<br>world <b>bold</b>" },
  ]);
  assert.equal(r.newHtml, DOC(`<p>hello<br>world <b>bold</b></p><p>after</p>`));
  assert.deepEqual(r.applied, [id]);
  assert.deepEqual(r.skipped, []);
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

test("buildSave preserves entities/quotes/comments elsewhere", () => {
  // comment, single-quoted attrs, sibling entities, single-quoted img src, <br> all untouched
  const html = `<!DOCTYPE html><html><head><title>t</title></head>` +
    `<body><!-- keep --><p id='x' data-k="v">Original</p>` +
    `<span>A&amp;B&nbsp;C</span><img src='a.jpg'><br></body></html>`;
  const id = editIdOf(html, "p");
  const r = buildSave(html, [
    { editId: id, kind: "text", originalContent: "Original", replacement: "Edited" },
  ]);
  assert.equal(r.newHtml,
    `<!DOCTYPE html><html><head><title>t</title></head>` +
    `<body><!-- keep --><p id='x' data-k="v">Edited</p>` +
    `<span>A&amp;B&nbsp;C</span><img src='a.jpg'><br></body></html>`);
});

// ---------- attr-add: inserting new attributes ----------

test("buildSave adds a new attribute when the element lacks it", () => {
  const html = DOC(`<img src="photo.jpg" width="300" height="200">`);
  const id = editIdOf(html, "img");
  const r = buildSave(html, [
    { editId: id, kind: "attr", attrName: "style", originalContent: "", value: "object-fit:cover" },
  ]);
  assert.equal(r.skipped.length, 0);
  assert.ok(r.applied.includes(id));
  assert.ok(r.newHtml.includes('style="object-fit:cover"'), "style attr should be present");
  assert.ok(r.newHtml.includes('src="photo.jpg"'), "existing src must be preserved");
});

test("buildSave inserts new attr before /> on self-closing void elements", () => {
  const html = DOC(`<img src="x.png" width="10" height="10" />`);
  const id = editIdOf(html, "img");
  const r = buildSave(html, [
    { editId: id, kind: "attr", attrName: "style", originalContent: "", value: "object-fit:cover" },
  ]);
  assert.equal(r.skipped.length, 0);
  assert.ok(r.newHtml.includes('style="object-fit:cover"'));
  // The /> must still be present (self-close preserved)
  assert.ok(r.newHtml.includes("/>"));
});

test("buildSave replaces an existing attribute when it is already present", () => {
  const html = DOC(`<img src="x.png" style="display:block">`);
  const id = editIdOf(html, "img");
  const r = buildSave(html, [
    { editId: id, kind: "attr", attrName: "style", originalContent: "", value: "object-fit:cover;display:block" },
  ]);
  assert.equal(r.skipped.length, 0);
  assert.ok(r.newHtml.includes('style="object-fit:cover;display:block"'));
  assert.ok(!r.newHtml.includes('style="display:block"'), "old style value should be gone");
});
