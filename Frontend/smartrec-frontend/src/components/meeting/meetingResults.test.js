import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evidenceReferences,
  formatActionDeadline,
  getSummaryViewState,
  getTasksViewState,
  mapMeetingResults,
  resolveEvidenceReferences,
} from "./meetingResults.js";

test("maps backend summary, category evidence and task references", () => {
  const result = mapMeetingResults({
    meetingId: "meeting-1",
    jobId: "job-1",
    jobStatus: "COMPLETED",
    llmStatus: "SUCCESS",
    llmProvider: "GEMINI",
    llmFallbackUsed: true,
    summary: {
      executiveSummary: "Summary text",
      details: {
        decisions: [{ text: "Use PostgreSQL", source_refs: ["TRANSCRIPT:t1"] }],
        key_points: [{ text: "Database selection", kind: "DISCUSSION", source_refs: ["TRANSCRIPT:t1"] }],
        open_issues: [],
        next_steps: [],
      },
    },
    actionItems: [{
      id: "task-1", title: "Prepare database design", assigneeName: "Minh",
      assigneeSpeakerId: "speaker-1", assignmentProvenance: "FIRST_PERSON_COMMITMENT",
      deadlineRaw: "trước thứ Sáu", dueDate: null, status: "OPEN",
      sourceTranscriptId: "t1", sourceRefs: ["TRANSCRIPT:t1", "SLIDE_OCR:s1"],
    }],
  });

  assert.equal(result.summary.executiveSummary, "Summary text");
  assert.equal(result.llmStatus, "SUCCESS");
  assert.equal(result.llmProvider, "GEMINI");
  assert.equal(result.llmFallbackUsed, true);
  assert.equal(result.summary.decisions[0].text, "Use PostgreSQL");
  assert.equal(result.summary.keyPoints[0].kind, "DISCUSSION");
  assert.equal(result.actionItems[0].title, "Prepare database design");
  assert.equal(result.actionItems[0].assigneeSpeakerId, "speaker-1");
  assert.equal(result.actionItems[0].assignmentProvenance, "FIRST_PERSON_COMMITMENT");
  assert.deepEqual(result.actionItems[0].sourceRefs, ["TRANSCRIPT:t1", "SLIDE_OCR:s1"]);
  assert.deepEqual(evidenceReferences(result.summary.decisions[0]), ["TRANSCRIPT:t1"]);
  assert.equal(formatActionDeadline(result.actionItems[0]), "trước thứ Sáu");
});

test("speaker rename submits stable ids and refreshes speaker and task result mappings", () => {
  const page = readFileSync(new URL("../../pages/meeting/MeetingDetailPage.jsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("SpeakerManagementPanel.jsx", new URL("./", import.meta.url)), "utf8");
  assert.match(page, /speakerId:\s*speaker\.speakerId\s*\|\|\s*speaker\.id/);
  assert.match(page, /api\.get\(`\/meetings\/\$\{id\}\/speakers`\)/);
  assert.match(page, /api\.get\(`\/meetings\/\$\{id\}\/jobs\/\$\{job\.id\}\/results`\)/);
  assert.match(page, /resultsSnapshotRef\.current\s*=\s*mappedResults/);
  assert.ok(panel.indexOf("await onSave(payload)") < panel.indexOf("setStatus('success')"));
  assert.match(panel, /setStatus\('error'\)[\s\S]*setErrorMessage/);
});

test("keeps default speaker assignees and unresolved tasks distinct in the task view", () => {
  const result = mapMeetingResults({ actionItems: [
    { id: "linked", title: "Complete upload tests", assigneeName: "Speaker 1", assigneeSpeakerId: "speaker-uuid" },
    { id: "unresolved", title: "Review progress", assigneeName: null, assigneeSpeakerId: null },
  ] });
  const tasks = readFileSync(new URL("MeetingTasksTab.jsx", new URL("./", import.meta.url)), "utf8");

  assert.equal(result.actionItems[0].assigneeName, "Speaker 1");
  assert.equal(result.actionItems[0].assigneeSpeakerId, "speaker-uuid");
  assert.equal(result.actionItems[1].assigneeName, null);
  assert.equal(result.actionItems[1].assigneeSpeakerId, null);
  assert.match(tasks, /task\.assigneeName\s*\|\|\s*'Chưa xác định'/);
  assert.match(tasks, /Cam kết được liên kết với người nói trong transcript/);
});

test("maps missing AI sections to empty states without inventing content", () => {
  const result = mapMeetingResults({ meetingId: "m", jobId: "j", actionItems: [] });
  assert.equal(result.summary, null);
  assert.deepEqual(result.actionItems, []);
  assert.deepEqual(result.transcripts, []);
});

test("resolves transcript UUIDs to actual timestamps and keeps missing citations unavailable", () => {
  const references = resolveEvidenceReferences([
    "TRANSCRIPT:segment-a", "TRANSCRIPT:segment-b", "TRANSCRIPT:segment-a", "SLIDE_OCR:slide-1",
  ], [
    { id: "segment-b", startTimeMs: 15000, endTimeMs: 18800, textContent: "Second", speakerLabel: "Speaker 1" },
    { id: "segment-a", startTimeMs: 10820, endTimeMs: 14700, textContent: "First", speakerLabel: "Speaker 1" },
  ]);

  assert.deepEqual(references.map(({ label, available, transcriptId }) => ({ label, available, transcriptId })), [
    { label: "Transcript · 00:10–00:14", available: true, transcriptId: "segment-a" },
    { label: "Transcript · 00:15–00:18", available: true, transcriptId: "segment-b" },
    { label: "Source unavailable", available: false, transcriptId: null },
  ]);
});

test("does not guess a transcript timestamp for an unresolved reference", () => {
  const [reference] = resolveEvidenceReferences(["TRANSCRIPT:missing-id"], []);
  assert.equal(reference.available, false);
  assert.equal(reference.label, "Transcript source unavailable");
  assert.equal(reference.transcriptId, null);
});

test("Summary and Tasks use the same accessible evidence navigation component", () => {
  const folder = new URL("./", import.meta.url);
  const summary = readFileSync(new URL("MeetingSummaryTab.jsx", folder), "utf8");
  const tasks = readFileSync(new URL("MeetingTasksTab.jsx", folder), "utf8");
  const evidence = readFileSync(new URL("EvidenceReferences.jsx", folder), "utf8");
  const transcript = readFileSync(new URL("TranscriptPanel.jsx", folder), "utf8");

  assert.match(summary, /import EvidenceReferences/);
  assert.match(tasks, /import EvidenceReferences/);
  assert.match(evidence, /onClick=\{\(\) => onNavigate\?\.\(reference\.transcriptId\)\}/);
  assert.match(evidence, /focus-visible:outline/);
  assert.match(evidence, /aria-label=\{`Open transcript evidence at/);
  assert.match(transcript, /navigateToEvidence\(transcriptId\)/);
  assert.match(transcript, /onEvidenceSeek\?\.\(segment\.startTimeMs \/ 1000\)/);
  assert.doesNotMatch(transcript, /onEvidenceSeek[\s\S]{0,80}\.play\(/);
});

test("selects summary and task loading, error, processing, empty and unavailable states", () => {
  assert.equal(getSummaryViewState({ loading: true, aiStatus: "completed" }), "loading");
  assert.equal(getSummaryViewState({ error: "network", aiStatus: "completed" }), "error");
  assert.equal(getSummaryViewState({ aiStatus: "processing" }), "processing");
  assert.equal(getSummaryViewState({ aiStatus: "completed" }), "unavailable");
  assert.equal(getTasksViewState({ tasks: [], hasSummary: true, aiStatus: "completed" }), "empty");
  assert.equal(getTasksViewState({ tasks: [], hasSummary: false, aiStatus: "completed" }), "unavailable");
  assert.equal(getTasksViewState({ tasks: [], aiStatus: "processing" }), "processing");
  assert.equal(getTasksViewState({ tasks: [], error: "network" }), "error");
  assert.equal(getSummaryViewState({ aiStatus: "enrichment_failed" }), "enrichment_failed");
  assert.equal(getTasksViewState({ tasks: [], aiStatus: "enrichment_disabled" }), "enrichment_disabled");
});

test("summary sections explain when evidence is insufficient without implying AI failure", () => {
  const summary = readFileSync(new URL("MeetingSummaryTab.jsx", new URL("./", import.meta.url)), "utf8");
  assert.match(summary, /Chưa xác định được quyết định đã xác nhận từ transcript\./);
  assert.match(summary, /Chưa có điểm chính đủ bằng chứng để ghi nhận\./);
  assert.match(summary, /Không có nội dung nào cần xem lại theo bằng chứng hiện có\./);
  assert.match(summary, /Chưa có bước tiếp theo đủ bằng chứng để ghi nhận\./);
  assert.match(summary, /viewState === 'enrichment_failed'/);
});
