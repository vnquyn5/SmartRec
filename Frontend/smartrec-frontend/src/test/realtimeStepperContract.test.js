/**
 * Unit & Contract Verification Suite for RealtimeStepper & WebSocket Data Contract
 * Sprint 4 - Frontend Testing Scope
 * 
 * Run with: node src/test/realtimeStepperContract.test.js
 */

import assert from "node:assert";
import {
  PIPELINE_STAGES,
  STAGE_ORDER,
  computeOverallProgress,
  isStatusCompleted,
  isStatusFailed,
  isStatusPaused,
  isStatusRunning,
  normalizeJobPayload,
} from "../types/jobProgress.js";

console.log("============================================================");
console.log("🚀 BẮT ĐẦU KIỂM THỬ CONTRACT & LOGIC REALTIME STEPPER (FE) ");
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
// TEST SUITE 1: Stage Mapping & Order Contract
// --------------------------------------------------------------------------
console.log("--- TEST SUITE 1: Stage Order & Pipeline Definition ---");
it("Phải có đúng 4 chặng pipeline theo thứ tự: FFMPEG -> WEBRTC -> PYANNOTE -> OUTPUT", () => {
  assert.strictEqual(PIPELINE_STAGES.length, 4);
  assert.strictEqual(PIPELINE_STAGES[0].key, "FFMPEG");
  assert.strictEqual(PIPELINE_STAGES[1].key, "WEBRTC");
  assert.strictEqual(PIPELINE_STAGES[2].key, "PYANNOTE");
  assert.strictEqual(PIPELINE_STAGES[3].key, "OUTPUT");

  assert.strictEqual(STAGE_ORDER["FFMPEG"], 1);
  assert.strictEqual(STAGE_ORDER["WEBRTC"], 2);
  assert.strictEqual(STAGE_ORDER["PYANNOTE"], 3);
  assert.strictEqual(STAGE_ORDER["OUTPUT"], 4);
});

// --------------------------------------------------------------------------
// TEST SUITE 2: Zero-Synthetic Failure Contract (TC-01)
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 2: Zero-Synthetic Failure Contract (BR03, TR01) ---");
it("TC-01: Job FAILED tuyệt đối KHÔNG ĐƯỢC đạt 100% (Zero-synthetic)", () => {
  const failedPayload = {
    jobId: "job-001",
    stage: "PYANNOTE",
    status: "FAILED",
    percentage: 100, // Thử gửi 100% giả lập từ server lỗi
    errorCode: "CUDA_OUT_OF_MEMORY",
    errorMessage: "Lỗi tràn bộ nhớ VRAM GPU khi chạy Diarization",
  };

  const normalized = normalizeJobPayload(failedPayload, "job-001");
  assert.ok(normalized, "Payload chuẩn hóa không được null");
  assert.strictEqual(normalized.status, "FAILED");
  assert.ok(normalized.percentage < 100, `Percentage phải < 100% nhưng nhận ${normalized.percentage}%`);
  assert.ok(isStatusFailed(normalized.status));
});

it("Tính toán tiến độ khi Job FAILED tại chặng WEBRTC chỉ dừng trong khoảng 25% - 50%", () => {
  const progress = computeOverallProgress("WEBRTC", 50, "FAILED");
  assert.ok(progress >= 25 && progress <= 50, `Tiến độ ${progress}% phải nằm trong chặng WEBRTC (25-50%)`);
});

// --------------------------------------------------------------------------
// TEST SUITE 3: Stale Guard & Multi-Job Protection (TR02)
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 3: Stale Response Guard (TR02) ---");
it("TC-02: Bỏ qua payload có jobId không khớp với Job đang theo dõi", () => {
  const activeJobId = "job-current-111";
  const stalePayload = {
    jobId: "job-old-999",
    stage: "OUTPUT",
    status: "COMPLETED",
    percentage: 100,
  };

  const normalized = normalizeJobPayload(stalePayload, activeJobId);
  assert.strictEqual(normalized, null, "Payload từ Job khác phải bị hủy bỏ ngay lập tức");
});

it("Payload hợp lệ cùng jobId được chuẩn hóa đầy đủ các trường nghiệp vụ", () => {
  const activeJobId = "job-current-111";
  const validPayload = {
    jobId: "job-current-111",
    meetingId: "meet-777",
    stage: "PYANNOTE",
    status: "PROCESSING",
    percentage: 65,
    stagePercentage: 42,
    retryCount: 1,
    eventId: "evt_12345",
  };

  const normalized = normalizeJobPayload(validPayload, activeJobId);
  assert.ok(normalized);
  assert.strictEqual(normalized.jobId, "job-current-111");
  assert.strictEqual(normalized.stage, "PYANNOTE");
  assert.strictEqual(normalized.status, "PROCESSING");
  assert.strictEqual(normalized.percentage, 65);
  assert.strictEqual(normalized.stagePercentage, 42);
  assert.strictEqual(normalized.retryCount, 1);
  assert.strictEqual(normalized.eventId, "evt_12345");
});

// --------------------------------------------------------------------------
// TEST SUITE 4: Status Helpers & State Transitions
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 4: Status Helper Functions ---");
it("Nhận diện chính xác các trạng thái COMPLETED / SUCCESS / SUCCEEDED", () => {
  assert.ok(isStatusCompleted("COMPLETED"));
  assert.ok(isStatusCompleted("SUCCESS"));
  assert.ok(isStatusCompleted("SUCCEEDED"));
  assert.ok(!isStatusCompleted("PROCESSING"));
  assert.ok(!isStatusCompleted("FAILED"));
});

it("Nhận diện chính xác các trạng thái RUNNING / PROCESSING / RETRYING", () => {
  assert.ok(isStatusRunning("PROCESSING"));
  assert.ok(isStatusRunning("RUNNING"));
  assert.ok(isStatusRunning("RETRYING"));
  assert.ok(!isStatusRunning("PAUSED"));
});

it("Nhận diện chính xác trạng thái PAUSED / PAUSE_REQUESTED", () => {
  assert.ok(isStatusPaused("PAUSED"));
  assert.ok(isStatusPaused("PAUSE_REQUESTED"));
  assert.ok(!isStatusPaused("COMPLETED"));
});

// --------------------------------------------------------------------------
// TỔNG KẾT KẾT QUẢ
// --------------------------------------------------------------------------
console.log("\n============================================================");
console.log(`🎯 KẾT QUẢ KIỂM THỬ: ${passedCount} PASS, ${failedCount} FAIL`);
console.log("============================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
