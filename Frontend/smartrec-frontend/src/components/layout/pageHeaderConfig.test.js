import assert from "node:assert/strict";
import test from "node:test";
import { getPageHeader } from "./pageHeaderConfig.js";

test("maps shared application routes to their page titles", () => {
  assert.equal(getPageHeader("/upload").title, "Tải lên cuộc họp");
  assert.equal(getPageHeader("/history").title, "Danh sách cuộc họp");
  assert.equal(getPageHeader("/trash").title, "Thùng rác");
  assert.equal(getPageHeader("/profile").title, "Cài đặt");
  assert.equal(getPageHeader("/history/").title, "Danh sách cuộc họp");
});

test("meeting details have a loading title until the page provides its real filename", () => {
  assert.deepEqual(getPageHeader("/meeting/meeting-id"), {
    title: "Đang tải cuộc họp…",
    subtitle: "Đang tải thông tin cuộc họp.",
  });
});

test("does not create titles for routes that are not registered in this layout", () => {
  assert.deepEqual(getPageHeader("/settings"), { title: "", subtitle: "" });
  assert.deepEqual(getPageHeader("/export"), { title: "", subtitle: "" });
});
