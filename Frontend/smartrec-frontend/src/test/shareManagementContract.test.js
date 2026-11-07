/**
 * Unit & Contract Verification Suite for Share Link & Passcode Management
 * Sprint 4 - Frontend Testing Scope
 * 
 * Run with: node src/test/shareManagementContract.test.js
 */

import assert from "node:assert";
import {
  SHARE_SCOPE,
  SHARE_LINK_STATUS,
  evaluatePasscodeStrength,
  normalizeShareLink,
} from "../types/share.js";

console.log("============================================================");
console.log("🚀 BẮT ĐẦU KIỂM THỬ CONTRACT & BẢO MẬT SHARE & PASSCODE ");
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
// TEST SUITE 1: Share Link Status Normalization (TC-01)
// --------------------------------------------------------------------------
console.log("--- TEST SUITE 1: Share Link Status Normalization (TC-01) ---");
it("TC-01A: Nhận diện chính xác Link đang hoạt động (ACTIVE)", () => {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const raw = {
    id: "lnk_1",
    meetingId: "meet_101",
    token: "tok_123",
    expiresAt: futureDate,
    isRevoked: false,
    scope: SHARE_SCOPE.VIEW_ONLY,
  };

  const normalized = normalizeShareLink(raw, "meet_101");
  assert.ok(normalized);
  assert.strictEqual(normalized.status, SHARE_LINK_STATUS.ACTIVE);
  assert.strictEqual(normalized.isRevoked, false);
  assert.strictEqual(normalized.isExpired, false);
});

it("TC-01B: Nhận diện chính xác Link đã hết hạn (EXPIRED)", () => {
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const raw = {
    id: "lnk_2",
    meetingId: "meet_101",
    token: "tok_expired",
    expiresAt: pastDate,
    isRevoked: false,
  };

  const normalized = normalizeShareLink(raw, "meet_101");
  assert.ok(normalized);
  assert.strictEqual(normalized.status, SHARE_LINK_STATUS.EXPIRED);
  assert.strictEqual(normalized.isExpired, true);
});

it("TC-01C: Nhận diện chính xác Link đã bị thu hồi (REVOKED)", () => {
  const raw = {
    id: "lnk_3",
    meetingId: "meet_101",
    token: "tok_rev",
    isRevoked: true,
  };

  const normalized = normalizeShareLink(raw, "meet_101");
  assert.ok(normalized);
  assert.strictEqual(normalized.status, SHARE_LINK_STATUS.REVOKED);
  assert.strictEqual(normalized.isRevoked, true);
});

// --------------------------------------------------------------------------
// TEST SUITE 2: Passcode Strength & Security Evaluation (TC-03, TR02)
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 2: Passcode Strength & Security Evaluation (TC-03) ---");
it("TC-03A: Từ chối Passcode dưới 4 ký tự", () => {
  const evalShort = evaluatePasscodeStrength("123");
  assert.strictEqual(evalShort.isAcceptable, false);
  assert.strictEqual(evalShort.score, 1);
});

it("TC-03B: Cảnh báo chuỗi dễ đoán (vd: 111111 hoặc 123456)", () => {
  const evalSimple = evaluatePasscodeStrength("111111");
  assert.strictEqual(evalSimple.score, 2);
  assert.ok(evalSimple.label.includes("Yếu"));
});

it("TC-03C: Đánh giá cao Passcode an toàn hỗn hợp chữ và số (8+ ký tự)", () => {
  const evalStrong = evaluatePasscodeStrength("SmartRec2026");
  assert.strictEqual(evalStrong.score, 4);
  assert.ok(evalStrong.isAcceptable);
});

// --------------------------------------------------------------------------
// TEST SUITE 3: Scope & Permissions Guard (TC-04)
// --------------------------------------------------------------------------
console.log("\n--- TEST SUITE 3: Scope & Permissions Guard (TC-04) ---");
it("TC-04: Mặc định gán Scope là VIEW_ONLY nếu dữ liệu không cung cấp", () => {
  const raw = { id: "lnk_4", meetingId: "meet_1" };
  const normalized = normalizeShareLink(raw, "meet_1");
  assert.strictEqual(normalized.scope, SHARE_SCOPE.VIEW_ONLY);
});

it("Gán đúng scope ALLOW_DOWNLOAD khi được chỉ định rõ", () => {
  const raw = { id: "lnk_5", meetingId: "meet_1", scope: SHARE_SCOPE.ALLOW_DOWNLOAD };
  const normalized = normalizeShareLink(raw, "meet_1");
  assert.strictEqual(normalized.scope, SHARE_SCOPE.ALLOW_DOWNLOAD);
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
