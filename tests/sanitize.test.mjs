import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { sanitizeInner } from "../src/sanitize.js";

function el(html) {
  const { window } = new JSDOM(`<!DOCTYPE html><body><div id="r">${html}</div>`);
  globalThis.Node = window.Node;
  return window.document.getElementById("r");
}

test("keeps text and escapes ampersand", () => {
  assert.equal(sanitizeInner(el(`Hello <b>bold</b> & <i>it</i>`)),
    "Hello <b>bold</b> &amp; <i>it</i>");
});

test("keeps br", () => {
  assert.equal(sanitizeInner(el(`Line<br>two`)), "Line<br>two");
});

test("keeps only href on links", () => {
  assert.equal(sanitizeInner(el(`<a href="x.html" onclick="bad()">go</a>`)),
    `<a href="x.html">go</a>`);
});

test("unwraps cruft like div/span/style", () => {
  assert.equal(sanitizeInner(el(`<div style="x"><span>plain</span></div>`)), "plain");
});

test("normalizes strong/em tag names through", () => {
  assert.equal(sanitizeInner(el(`<strong>S</strong>`)), "<strong>S</strong>");
});
