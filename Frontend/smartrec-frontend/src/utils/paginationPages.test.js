import assert from "node:assert/strict";
import test from "node:test";
import { getPaginationPages } from "./paginationPages.js";

test("shows every page for short result sets", () => {
  assert.deepEqual(getPaginationPages(4, 1), [0, 1, 2, 3]);
});

test("keeps the first, last and nearby pages visible with gaps", () => {
  assert.deepEqual(getPaginationPages(12, 0), [0, 1, 2, "ellipsis-2-11", 11]);
  assert.deepEqual(getPaginationPages(12, 6), [0, "ellipsis-0-5", 5, 6, 7, "ellipsis-7-11", 11]);
});
