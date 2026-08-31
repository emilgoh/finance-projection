import test from "node:test";
import assert from "node:assert/strict";
import { PAGES, DEFAULT_PAGE, pageFromHash, hashForPage, startRouter } from "../js/router.js";

/* ---------- pageFromHash ---------- */

test("pageFromHash: reads both known pages", () => {
  assert.equal(pageFromHash("#/projection"), "projection");
  assert.equal(pageFromHash("#/tracker"), "tracker");
});

test("pageFromHash: tolerates a missing slash and odd casing", () => {
  assert.equal(pageFromHash("#tracker"), "tracker");
  assert.equal(pageFromHash("#/Tracker"), "tracker");
});

test("pageFromHash: anything unrecognised falls back to the default page", () => {
  for (const hash of ["", "#", "#/", "#/nope", undefined, null]) {
    assert.equal(pageFromHash(hash), DEFAULT_PAGE);
  }
});

test("hashForPage: round-trips every page", () => {
  for (const page of PAGES) assert.equal(pageFromHash(hashForPage(page)), page);
});

/* ---------- startRouter ---------- */

/** Minimal stand-in for window: a mutable hash and one event listener. */
function fakeWindow(hash = "") {
  const listeners = new Set();
  return {
    location: { hash },
    addEventListener: (type, fn) => type === "hashchange" && listeners.add(fn),
    removeEventListener: (type, fn) => type === "hashchange" && listeners.delete(fn),
    go(next) { this.location.hash = next; for (const fn of listeners) fn(); },
    get listenerCount() { return listeners.size; },
  };
}

test("startRouter: fires once immediately so the first page paints", () => {
  const win = fakeWindow("#/tracker");
  const seen = [];
  startRouter(win, (page) => seen.push(page));
  assert.deepEqual(seen, ["tracker"]);
});

test("startRouter: reports each hash change", () => {
  const win = fakeWindow("#/projection");
  const seen = [];
  startRouter(win, (page) => seen.push(page));
  win.go("#/tracker");
  win.go("#/projection");
  assert.deepEqual(seen, ["projection", "tracker", "projection"]);
});

test("startRouter: the disposer stops further calls", () => {
  const win = fakeWindow("#/projection");
  const seen = [];
  const stop = startRouter(win, (page) => seen.push(page));
  stop();
  win.go("#/tracker");
  assert.deepEqual(seen, ["projection"]);
  assert.equal(win.listenerCount, 0);
});
