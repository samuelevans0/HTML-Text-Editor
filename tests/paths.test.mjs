import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePath, isHtml, extname, dirname } from "../src/paths.js";

test("resolves siblings and subfolders relative to current page", () => {
  assert.deepEqual(resolvePath("index.html", "about.html"), { path: "about.html" });
  assert.deepEqual(resolvePath("about/index.html", "../contact.html"), { path: "contact.html" });
  assert.deepEqual(resolvePath("index.html", "blog/post.html#top"), { path: "blog/post.html" });
  assert.deepEqual(resolvePath("blog/index.html", "post.html?x=1"), { path: "blog/post.html" });
});

test("directory links map to index.html", () => {
  assert.deepEqual(resolvePath("index.html", "blog/"), { path: "blog/index.html" });
  assert.deepEqual(resolvePath("index.html", "about"), { path: "about/index.html" });
});

test("absolute (site-root) paths resolve from root", () => {
  assert.deepEqual(resolvePath("blog/post.html", "/styles.css"), { path: "styles.css" });
});

test("external and special schemes flagged", () => {
  assert.deepEqual(resolvePath("index.html", "https://x.com"), { external: true });
  assert.deepEqual(resolvePath("index.html", "//cdn.x.com/a.js"), { external: true });
  assert.deepEqual(resolvePath("index.html", "mailto:a@b.c"), { external: true });
  assert.deepEqual(resolvePath("index.html", "tel:123"), { external: true });
});

test("escaping the root returns null", () => {
  assert.equal(resolvePath("index.html", "../../etc/passwd"), null);
});

test("helpers", () => {
  assert.equal(isHtml("a/b.html"), true);
  assert.equal(isHtml("a/b.htm"), true);
  assert.equal(isHtml("a/b.css"), false);
  assert.equal(extname("a/b.JPG"), ".jpg");
  assert.equal(dirname("a/b/c.html"), "a/b");
});
