import { api as httpClient } from "../lib/http/client.js";
import { normalizeShareLink, SHARE_SCOPE, SHARE_LINK_STATUS } from "../types/share.js";
import mockShareData from "../mocks/mock_share_links.json";

// Bộ nhớ Session Memory tạm thời (In-memory Cache - Không lưu plain passcode vào localStorage theo TR02/4.2)
const memoryShareStore = new Map();
const memorySecurityStore = new Map();

/**
 * Khởi tạo dữ liệu mẫu ban đầu cho cuộc họp nếu chưa có trong session memory
 */
function initMeetingMemoryStore(meetingId) {
  if (!memoryShareStore.has(meetingId)) {
    const defaultList = mockShareData.shares_by_meeting_id["default"] || [];
    const initialLinks = defaultList.map((item) =>
      normalizeShareLink({ ...item, meetingId }, meetingId)
    );
    memoryShareStore.set(meetingId, initialLinks);
  }

  if (!memorySecurityStore.has(meetingId)) {
    const defaultSec = mockShareData.security_settings_by_meeting_id["default"] || {
      isPasscodeProtected: false,
      allowPublicSharing: true,
    };
    memorySecurityStore.set(meetingId, { ...defaultSec });
  }
}

/**
 * Lấy danh sách Public Share Links của cuộc họp
 */
export async function getMeetingShareLinks(meetingId) {
  if (!meetingId) return [];
  initMeetingMemoryStore(meetingId);

  try {
    const response = await httpClient.get(`/meetings/${meetingId}/shares`);
    const list = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
    if (list.length > 0) {
      const normalized = list.map((item) => normalizeShareLink(item, meetingId));
      memoryShareStore.set(meetingId, normalized);
      return normalized;
    }
  } catch (err) {
    // Graceful fallback to memory store if backend endpoint not implemented yet
  }

  return memoryShareStore.get(meetingId) || [];
}

/**
 * Lấy thông tin cài đặt bảo mật / Passcode của cuộc họp
 */
export async function getMeetingSecuritySettings(meetingId) {
  if (!meetingId) return { isPasscodeProtected: false, allowPublicSharing: true };
  initMeetingMemoryStore(meetingId);

  try {
    const response = await httpClient.get(`/meetings/${meetingId}/security`);
    if (response?.data) {
      memorySecurityStore.set(meetingId, response.data);
      return response.data;
    }
  } catch (err) {
    // Fallback to memory store
  }

  return memorySecurityStore.get(meetingId);
}

/**
 * Tạo một Public Share Link mới
 * @param {string} meetingId
 * @param {Object} options
 * @param {number} [options.expiresInDays] Số ngày hết hạn (null nếu vô thời hạn)
 * @param {string} [options.scope] VIEW_ONLY | ALLOW_DOWNLOAD
 * @param {boolean} [options.hasPasscode]
 */
export async function createMeetingShareLink(meetingId, {
  expiresInDays = 7,
  scope = SHARE_SCOPE.VIEW_ONLY,
  hasPasscode = false,
} = {}) {
  if (!meetingId) throw new Error("meetingId không hợp lệ");
  initMeetingMemoryStore(meetingId);

  const now = new Date();
  const expiresAt = expiresInDays != null && expiresInDays > 0
    ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const payload = {
    meetingId,
    expiresInDays,
    scope,
    hasPasscode,
    expiresAt,
  };

  try {
    const response = await httpClient.post(`/meetings/${meetingId}/shares`, payload);
    const raw = response?.data || response;
    if (raw && typeof raw === "object") {
      const created = normalizeShareLink(raw, meetingId);
      const currentList = memoryShareStore.get(meetingId) || [];
      memoryShareStore.set(meetingId, [created, ...currentList]);
      return created;
    }
  } catch (err) {
    // Fallback local memory creation
  }

  // Fallback in-memory link creation
  const localCreated = normalizeShareLink({
    id: `lnk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    meetingId,
    token: `tok_${Math.random().toString(36).substring(2, 14)}`,
    scope,
    createdAt: now.toISOString(),
    expiresAt,
    isRevoked: false,
    accessCount: 0,
    hasPasscode,
  }, meetingId);

  const currentList = memoryShareStore.get(meetingId) || [];
  memoryShareStore.set(meetingId, [localCreated, ...currentList]);
  return localCreated;
}

/**
 * Thu hồi (Revoke) một Public Share Link
 * @param {string} meetingId
 * @param {string} linkId
 */
export async function revokeMeetingShareLink(meetingId, linkId) {
  if (!meetingId || !linkId) throw new Error("Thiếu tham số thu hồi link");
  initMeetingMemoryStore(meetingId);

  try {
    await httpClient.post(`/meetings/${meetingId}/shares/${linkId}/revoke`);
  } catch (err) {
    // Fallback local update
  }

  // Optimistic memory update
  const currentList = memoryShareStore.get(meetingId) || [];
  const updated = currentList.map((item) =>
    item.id === linkId
      ? { ...item, isRevoked: true, status: SHARE_LINK_STATUS.REVOKED }
      : item
  );
  memoryShareStore.set(meetingId, updated);
  return true;
}

/**
 * Cập nhật Passcode bảo vệ cuộc họp (TR02: Tuyệt đối KHÔNG lưu plain passcode vào localStorage/console)
 * @param {string} meetingId
 * @param {string} newPasscode
 */
export async function updateMeetingPasscode(meetingId, newPasscode) {
  if (!meetingId) throw new Error("meetingId không hợp lệ");
  const cleanPasscode = String(newPasscode || "").trim();
  if (cleanPasscode.length < 4) {
    throw new Error("Mật mã bảo vệ phải có tối thiểu 4 ký tự");
  }

  try {
    await httpClient.put(`/meetings/${meetingId}/passcode`, {
      passcode: cleanPasscode,
    });
  } catch (err) {
    // Fallback memory state
  }

  // Cập nhật trạng thái trong session memory (Không lưu plain passcode vào localStorage)
  initMeetingMemoryStore(meetingId);
  const currentSec = memorySecurityStore.get(meetingId) || {};
  memorySecurityStore.set(meetingId, {
    ...currentSec,
    isPasscodeProtected: true,
    passcodeHint: `${cleanPasscode.length} ký tự`,
  });

  return true;
}

/**
 * Xóa bỏ bảo vệ Passcode cho cuộc họp
 * @param {string} meetingId
 */
export async function removeMeetingPasscode(meetingId) {
  if (!meetingId) return false;
  initMeetingMemoryStore(meetingId);

  try {
    await httpClient.delete(`/meetings/${meetingId}/passcode`);
  } catch (err) {
    // Fallback
  }

  const currentSec = memorySecurityStore.get(meetingId) || {};
  memorySecurityStore.set(meetingId, {
    ...currentSec,
    isPasscodeProtected: false,
    passcodeHint: null,
  });

  return true;
}
