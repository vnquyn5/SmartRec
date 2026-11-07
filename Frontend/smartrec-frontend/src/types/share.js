/**
 * SmartRec Public Share & Passcode Management Data Contract
 * Sprint 4 - Frontend Specification
 */

export const SHARE_SCOPE = Object.freeze({
  VIEW_ONLY: "VIEW_ONLY",
  ALLOW_DOWNLOAD: "ALLOW_DOWNLOAD",
});

export const SHARE_SCOPE_LABELS = Object.freeze({
  VIEW_ONLY: "Chỉ xem trực tuyến",
  ALLOW_DOWNLOAD: "Xem & Tải bản ghi",
});

export const SHARE_LINK_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
});

/**
 * Đánh giá độ mạnh của Passcode / PIN
 * @param {string} code
 * @returns {{ score: number, label: string, colorClass: string, isAcceptable: boolean }}
 */
export function evaluatePasscodeStrength(code) {
  if (!code || typeof code !== "string") {
    return { score: 0, label: "Trống", colorClass: "text-slate-400 bg-slate-700", isAcceptable: false };
  }

  const trimmed = code.trim();
  if (trimmed.length < 4) {
    return { score: 1, label: "Quá ngắn (Tối thiểu 4 ký tự)", colorClass: "text-red-400 bg-red-500", isAcceptable: false };
  }

  // Kiểm tra chuỗi đơn điệu (vd: 1111, 1234, 000000)
  const isRepeated = /^(\w)\1+$/.test(trimmed);
  const isSequence = "0123456789012345".includes(trimmed) || "9876543210".includes(trimmed);

  if (isRepeated || (isSequence && trimmed.length <= 6)) {
    return { score: 2, label: "Yếu (Chuỗi dễ đoán)", colorClass: "text-amber-400 bg-amber-500", isAcceptable: true };
  }

  if (trimmed.length >= 8 && /[a-zA-Z]/.test(trimmed) && /[0-9]/.test(trimmed)) {
    return { score: 4, label: "Rất mạnh (Chữ & Số)", colorClass: "text-emerald-400 bg-emerald-500", isAcceptable: true };
  }

  if (trimmed.length >= 6) {
    return { score: 3, label: "Tốt (Đạt tiêu chuẩn)", colorClass: "text-cyan-400 bg-cyan-500", isAcceptable: true };
  }

  return { score: 2, label: "Trung bình", colorClass: "text-amber-400 bg-amber-500", isAcceptable: true };
}

/**
 * Chuẩn hóa đối tượng ShareLink
 * @param {Object} raw Dữ liệu thô từ backend hoặc mock
 * @param {string} meetingId ID cuộc họp
 * @returns {Object|null}
 */
export function normalizeShareLink(raw, meetingId) {
  if (!raw || typeof raw !== "object") return null;

  const id = raw.id || `lnk_${Math.random().toString(36).substring(2, 9)}`;
  const token = raw.token || `tok_${Math.random().toString(36).substring(2, 12)}`;
  const targetMeetingId = raw.meetingId || meetingId;

  // Tính toán hạn dùng
  const now = new Date();
  const expiresAt = raw.expiresAt ? new Date(raw.expiresAt).toISOString() : null;
  const isExpired = expiresAt ? new Date(expiresAt) < now : false;
  const isRevoked = Boolean(raw.isRevoked || raw.revoked);

  let status = SHARE_LINK_STATUS.ACTIVE;
  if (isRevoked) {
    status = SHARE_LINK_STATUS.REVOKED;
  } else if (isExpired) {
    status = SHARE_LINK_STATUS.EXPIRED;
  }

  const scope = raw.scope === SHARE_SCOPE.ALLOW_DOWNLOAD ? SHARE_SCOPE.ALLOW_DOWNLOAD : SHARE_SCOPE.VIEW_ONLY;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://smartrec.app";
  const shareUrl = raw.shareUrl || `${origin}/shared/meeting/${targetMeetingId}?token=${token}`;

  return {
    id,
    meetingId: targetMeetingId,
    token,
    shareUrl,
    scope,
    scopeLabel: SHARE_SCOPE_LABELS[scope],
    createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : now.toISOString(),
    expiresAt,
    isExpired,
    isRevoked,
    status,
    accessCount: Number(raw.accessCount) || 0,
    hasPasscode: Boolean(raw.hasPasscode),
  };
}
