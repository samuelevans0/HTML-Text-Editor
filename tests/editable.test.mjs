import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isEditableText, collectEditables } from "../src/editable.js";

function doc(html) {
  const { window } = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  globalThis.Node = window.Node;
  return window.document;
}

test("leaf text blocks are editable; block containers and nested editables are not", () => {
  const d = doc(`<section><h1>Title</h1><p>Some <a href="x">link</a> text</p></section>`);
  const tags = collectEditables(d).map((e) => e.tagName);
  assert.deepEqual(tags, ["H1", "P"]); // section is a container; <a> is nested in <p>
});

test("whitespace-only and script/style are not editable", () => {
  const d = doc(`<div>   </div><script>var x=1</script><style>.a{}</style><p>Hi</p>`);
  const tags = collectEditables(d).map((e) => e.tagName);
  assert.deepEqual(tags, ["P"]);
});

test("a standalone link block is editable", () => {
  const d = doc(`<nav><a href="x">Click here</a></nav>`);
  const tags = collectEditables(d).map((e) => e.tagName);
  assert.deepEqual(tags, ["A"]);
});
