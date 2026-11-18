import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptJobProgressMessage,
  acceptJobProgressSequence,
  getReconnectDelay,
  mergeWorkspaceJobProgress,
} from "./jobProgressState.js";

test("accepts only increasing event sequences and ignores duplicates or old events", () => {
  const sequences = new Map();
  assert.equal(acceptJobProgressSequence(sequences, "job-a", 4), true);
  assert.equal(acceptJobProgressSequence(sequences, "job-a", 4), false);
  assert.equal(acceptJobProgressSequence(sequences, "job-a", 3), false);
  assert.equal(acceptJobProgressSequence(sequences, "job-a", 5), true);
  assert.equal(sequences.get("job-a"), 5);
});

test("tracks sequences per job and rejects malformed values", () => {
  const sequences = new Map();
  assert.equal(acceptJobProgressSequence(sequences, "job-a", 8), true);
  assert.equal(acceptJobProgressSequence(sequences, "job-b", 2), true);
  assert.equal(acceptJobProgressSequence(sequences, "job-b", "invalid"), false);
  assert.equal(sequences.get("job-a"), 8);
  assert.equal(sequences.get("job-b"), 2);
});

test("rejects messages from an old meeting or job and maps a valid progress event", () => {
  const sequences = new Map();
  const event = {
    jobId: "job-current",
    meetingId: "meeting-current",
    status: "PROCESSING",
    current_stage: "PYANNOTE",
    progress_percent: 50,
    sequence: 11,
    timestamp: "2026-11-18T09:40:00Z",
  };
  assert.equal(acceptJobProgressMessage(sequences, event, "meeting-current", "job-old"), null);
  assert.equal(acceptJobProgressMessage(sequences, event, "meeting-old", "job-current"), null);
  assert.deepEqual(
    acceptJobProgressMessage(sequences, event, "meeting-current", "job-current"),
    {
      jobId: "job-current",
      meetingId: "meeting-current",
      status: "PROCESSING",
      currentStage: "PYANNOTE",
      progressPercent: 50,
      sequence: 11,
      updatedAt: "2026-11-18T09:40:00Z",
    },
  );
  assert.equal(acceptJobProgressMessage(sequences, event, "meeting-current", "job-current"), null);
});

test("reconnect delay grows exponentially and has a bounded maximum", () => {
  assert.equal(getReconnectDelay(0, () => 0.5), 500);
  assert.equal(getReconnectDelay(3, () => 0.5), 4_000);
  assert.ok(getReconnectDelay(20, () => 0.5) <= 30_000);
});

test("workspace applies current job progress and ignores events for stale meeting or job rows", () => {
  const meeting = { id: "meeting-a", activeJobId: "job-a", status: "PROCESSING" };
  const progress = {
    meetingId: "meeting-a",
    jobId: "job-a",
    status: "SUCCEEDED",
    currentStage: "STT",
    progressPercent: 100,
    sequence: 9,
  };

  assert.deepEqual(mergeWorkspaceJobProgress(meeting, progress), {
    ...meeting,
    status: "COMPLETED",
    progressPercent: 100,
    currentStage: "STT",
    progressSequence: 9,
  });
  assert.strictEqual(
    mergeWorkspaceJobProgress(meeting, { ...progress, meetingId: "meeting-old" }),
    meeting,
  );
  assert.strictEqual(
    mergeWorkspaceJobProgress(meeting, { ...progress, jobId: "job-old" }),
    meeting,
  );

  for (const status of ["COMPLETED", "FAILED", "CANCELLED"]) {
    assert.equal(
      mergeWorkspaceJobProgress(meeting, { ...progress, status }).status,
      status,
    );
  }
});
