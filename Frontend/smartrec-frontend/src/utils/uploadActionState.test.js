import assert from "node:assert/strict";
import test from "node:test";
import { getUploadActionButtonState } from "./uploadActionState.js";

test("keeps upload action visible but disabled without selected files", () => {
  assert.deepEqual(getUploadActionButtonState(), {
    label: "Bắt đầu tải lên",
    loading: false,
    disabled: true,
  });
});

test("enables upload for one or more selected files with valid names", () => {
  for (const preparedCount of [1, 3]) {
    assert.deepEqual(
      getUploadActionButtonState({ preparedCount, arePreparedNamesValid: true }),
      { label: "Bắt đầu tải lên", loading: false, disabled: false },
    );
  }
});

test("disables upload when a filename is invalid", () => {
  assert.equal(
    getUploadActionButtonState({
      preparedCount: 1,
      arePreparedNamesValid: false,
    }).disabled,
    true,
  );
});

test("shows a disabled loading action while an upload is active", () => {
  for (const state of [
    { isStartingUploads: true },
    { hasUploadInProgress: true },
    { pendingChunkCount: 1 },
  ]) {
    assert.deepEqual(getUploadActionButtonState(state), {
      label: "Đang tải lên...",
      loading: true,
      disabled: true,
    });
  }
});
