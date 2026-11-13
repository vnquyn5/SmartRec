import assert from "node:assert/strict";
import test from "node:test";
import {
  getUploadFileNameDraft,
  normalizeUploadFileName,
  splitUploadFileName,
} from "./uploadFileName.js";

test("splits a media filename at its final extension", () => {
  assert.deepEqual(splitUploadFileName("SmartRec_E2E_M2_30s.mp3"), {
    baseName: "SmartRec_E2E_M2_30s",
    extension: ".mp3",
  });
  assert.deepEqual(splitUploadFileName("meeting.final.v2.mkv"), {
    baseName: "meeting.final.v2",
    extension: ".mkv",
  });
});

test("treats a supported dotfile extension as a fixed suffix", () => {
  assert.deepEqual(splitUploadFileName(".mp4"), {
    baseName: "",
    extension: ".mp4",
  });
  assert.deepEqual(splitUploadFileName(".private-recording"), {
    baseName: ".private-recording",
    extension: "",
  });
});

test("keeps an empty name empty while the extension remains separate", () => {
  const draft = getUploadFileNameDraft({
    fileName: ".mp4",
    sourceFileName: "SmartRec_E2E_M2_30s.mp4",
  });
  assert.deepEqual(draft, {
    baseName: "SmartRec_E2E_M2_30s",
    extension: ".mp4",
  });
  assert.equal(normalizeUploadFileName("", ".mp4"), null);
  assert.equal(normalizeUploadFileName("   ", ".mp4"), null);
});

test("normalizes the basename without changing or duplicating the extension", () => {
  assert.equal(
    normalizeUploadFileName("  Meeting 01  ", ".mp3"),
    "Meeting 01.mp3",
  );
  assert.equal(
    normalizeUploadFileName("Meeting.v2.mp3", ".mp3"),
    "Meeting.v2.mp3",
  );
  assert.equal(normalizeUploadFileName("Meeting.v2", ""), "Meeting.v2");
});

test("rejects path separators and limits the full filename length", () => {
  assert.equal(normalizeUploadFileName("a/b\\c", ".m4a"), null);
  assert.equal(
    normalizeUploadFileName("x".repeat(600), ".mkv").length,
    500,
  );
});

test("preserves Unicode names and rejects whitespace-only or control names", () => {
  assert.equal(normalizeUploadFileName("  Cuộc họp tháng 11  ", ".m4a"), "Cuộc họp tháng 11.m4a");
  assert.equal(normalizeUploadFileName("\t\n", ".mp3"), null);
  assert.equal(normalizeUploadFileName("meeting\u0000name", ".mp3"), null);
});
