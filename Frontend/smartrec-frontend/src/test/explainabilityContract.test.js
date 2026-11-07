/**
 * Unit & Contract Verification Suite for ExplainabilityDrawer & Evidence Contract
 * Sprint 4 - Frontend Testing Scope
 * 
 * Run with: node src/test/explainabilityContract.test.js
 */

import assert from "node:assert";
import {
  CONFIDENCE_METHODOLOGY,
  CONFIDENCE_METHODOLOGY_LABELS,
  UNCAlIBRATED_CONFIDENCE_DISCLAIMER,
  normalizeExplainabilityEvidence,
  shouldDisplaySlideEvidence,
} from "../types/explainability.js";

console.log("============================================================");
console.log("🚀 BẮT ĐẦU KIỂM THỬ CONTRACT & LOGIC EXPLAINABILITY DRAWER ");
console.log("============================================================\n");

let passedCount = 0;
let failedCount = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${description}`);
    passedCount++;
  } catch (error) {
    console.error(`  ❌ FAIL: ${description}`);
    console.error(`     Error: ${error.message}`);
    failedCount++;
  }
}

// --------------------------------------------------------------------------
// TEST SUITE 1: Task Evidence Normalization & Audio Seek (TC-01)
// --------------------------------------------------------------------------
console.log("--- TEST SUITE 1: Task Evidence Normalization & Audio Seek (TC-01) ---");
it("TC-01: Chuẩn hóa Task Evidence và tính toán chính xác timestampSeconds (792s)", () => {
  const rawTask = {
    taskIndex: 1,
    taskContent: "Hoàn thiện môi trường dev",
    assignee: "dev_team",
    timestamp: "13:12",
    timestampSeconds: 792,
    speakerName: "John Doe",
    sourceText: "Dev team cần tập trung hoàn thiện dev environment.",
    heuristicConfidence: 0.89,
    slideReference: {
      slideId: "slide-01",
      slideTitle: "Q4 Roadmap",
      timestamp: "05:12",
    },
  };

  const normalized = normalizeExplainabilityEvidence(rawTask, { type: "task" });
  assert.ok(normalized);
  assert.strictEqual(normalized.type, "task");
  assert.strictEqual(normalized.targetIndex, 1);
  assert.strictEqual(normalized.sourceAudio.timestampSeconds, 792);
  assert.strictEqual(normalized.sourceAudio.speakerName, "John Doe");
  assert.strictEqual(normalized.sourceAudio.timestamp, "13:12");
  assert.ok(normalized.sourceSlide);
  assert.strictEqual(normalized.sourceSlide.slideTitle, "Q4 Roadmap");
});

// --------------------------------------------------------------------------
// TEST SUITE 2: Audio-Only Guard for Slide Keyframes (TC-02)
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 2: Audio-Only Guard for Slide Keyframes (TC-02) ---");
it("TC-02A: Khi fileType là 'audio', TUYỆT ĐỐI KHÔNG hiển thị Slide Keyframe", () => {
  const evidenceWithSlide = {
    sourceSlide: {
      slideId: "slide-01",
      slideTitle: "Q4 Roadmap",
      timestamp: "05:12",
    },
  };

  const showSlideForAudio = shouldDisplaySlideEvidence("audio", evidenceWithSlide);
  assert.strictEqual(showSlideForAudio, false, "Bản ghi âm thuần (Audio-only) bắt buộc phải ẩn Slide");
});

it("TC-02B: Khi fileType là 'video' và có Slide Reference, CHO PHÉP hiển thị Slide", () => {
  const evidenceWithSlide = {
    sourceSlide: {
      slideId: "slide-01",
      slideTitle: "Q4 Roadmap",
      timestamp: "05:12",
    },
  };

  const showSlideForVideo = shouldDisplaySlideEvidence("video", evidenceWithSlide);
  assert.strictEqual(showSlideForVideo, true, "Bản ghi hình (Video) được phép hiển thị Slide");
});

// --------------------------------------------------------------------------
// TEST SUITE 3: Transparent Confidence & Heuristic Warning (TR01, TC-03)
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 3: Transparent Confidence & Disclaimer (TR01, TC-03) ---");
it("TC-03: Confidence Heuristic KHÔNG ĐƯỢC đánh dấu là xác suất đã hiệu chuẩn (isCalibrated = false)", () => {
  const raw = {
    taskIndex: 2,
    heuristicConfidence: 0.94,
    methodology: CONFIDENCE_METHODOLOGY.SEMANTIC_SIMILARITY,
  };

  const normalized = normalizeExplainabilityEvidence(raw);
  assert.strictEqual(normalized.confidence.isCalibrated, false);
  assert.strictEqual(normalized.confidence.percentage, 94);
  assert.ok(normalized.confidence.disclaimer.includes("chưa hiệu chuẩn xác suất"));
  assert.strictEqual(
    normalized.confidence.methodologyLabel,
    CONFIDENCE_METHODOLOGY_LABELS.SEMANTIC_SIMILARITY
  );
});

// --------------------------------------------------------------------------
// TEST SUITE 4: Summary Evidence Normalization
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 4: Summary Evidence Support (BR01) ---");
it("Chuẩn hóa thành công minh chứng cho mục AI Summary", () => {
  const rawSummary = {
    summaryIndex: 1,
    heading: "Mục tiêu Q4",
    content: "Tăng trưởng doanh thu 20%",
    timestamp: "00:12",
    timestampSeconds: 12,
    speakerName: "John Doe",
  };

  const normalized = normalizeExplainabilityEvidence(rawSummary, { type: "summary" });
  assert.ok(normalized);
  assert.strictEqual(normalized.type, "summary");
  assert.strictEqual(normalized.targetIndex, 1);
  assert.strictEqual(normalized.sourceAudio.timestampSeconds, 12);
});

// --------------------------------------------------------------------------
// TEST SUITE 5: Fallback & Error Handling (BR03)
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 5: Fallback & Null Safety (BR03) ---");
it("Xử lý an toàn khi đầu vào rỗng (null / undefined), không gây sập ứng dụng", () => {
  assert.strictEqual(normalizeExplainabilityEvidence(null), null);
  assert.strictEqual(normalizeExplainabilityEvidence(undefined), null);
});

// --------------------------------------------------------------------------
// TỔNG KẾT
// --------------------------------------------------------------------------
console.log("\n============================================================");
console.log(`🎯 KẾT QUẢ KIỂM THỬ: ${passedCount} PASS, ${failedCount} FAIL`);
console.log("============================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
