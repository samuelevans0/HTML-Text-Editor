import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSite } from "../src/app.js";

test("matchSite finds exact last-segment match", () => {
  assert.equal(matchSite("Berry Hill Farm", ["Berry Hill Farm", "CubingClubs.net"]), "Berry Hill Farm");
  assert.equal(matchSite("public", ["Berry Hill Farm/public", "other"]), "Berry Hill Farm/public");
});

test("matchSite falls back to case-insensitive last-segment", () => {
  assert.equal(matchSite("berry hill farm", ["Berry Hill Farm"]), "Berry Hill Farm");
});

test("matchSite matches any path segment (dragging parent folder)", () => {
  // User drags "Samuel Evans" but site is listed as "Samuel Evans/public"
  assert.equal(matchSite("Samuel Evans", ["Berry Hill Farm/public", "Samuel Evans/public"]), "Samuel Evans/public");
  assert.equal(matchSite("Berry Hill Farm", ["Berry Hill Farm/public", "Samuel Evans/public"]), "Berry Hill Farm/public");
});

test("matchSite matches any segment case-insensitively", () => {
  assert.equal(matchSite("samuel evans", ["Samuel Evans/public"]), "Samuel Evans/public");
});

test("matchSite returns null when nothing matches", () => {
  assert.equal(matchSite("Nope", ["A", "B"]), null);
});
