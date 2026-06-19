import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSite } from "../src/app.js";

test("matchSite finds exact last-segment match", () => {
  assert.equal(matchSite("Berry Hill Farm", ["Berry Hill Farm", "CubingClubs.net"]), "Berry Hill Farm");
  assert.equal(matchSite("public", ["Berry Hill Farm/public", "other"]), "Berry Hill Farm/public");
});

test("matchSite falls back to case-insensitive", () => {
  assert.equal(matchSite("berry hill farm", ["Berry Hill Farm"]), "Berry Hill Farm");
});

test("matchSite returns null when nothing matches", () => {
  assert.equal(matchSite("Nope", ["A", "B"]), null);
});
