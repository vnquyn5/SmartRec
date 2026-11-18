import React, { useState, useEffect, useCallback } from "react";
import { ShareIcon } from "../common/icons";
import {
  SHARE_SCOPE,
  SHARE_LINK_STATUS,
  evaluatePasscodeStrength,
} from "../../types/share";
import {
  getMeetingShareLinks,
  createMeetingShareLink,
  revokeMeetingShareLink,
  getMeetingSecuritySettings,
  updateMeetingPasscode,
  removeMeetingPasscode,
} from "../../services/shareService";

/* -------------------------------------------------------------------------- */
/* Micro Icons                                                                */
/* -------------------------------------------------------------------------- */
function LockIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function LinkIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ShieldCheckIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function AlertOctagonIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export default function ShareMeetingModal({
  meeting,
  onClose,
  isOwner = true,
}) {
  const meetingId = meeting?.id;
  const fileName = meeting?.fileName || meeting?.title || "Cuộc họp";

  // Tab State: 'links' | 'passcode'
  const [activeTab, setActiveTab] = useState("links");

  // Dữ liệu Links & Settings
  const [links, setLinks] = useState([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [securitySettings, setSecuritySettings] = useState({
    isPasscodeProtected: false,
    allowPublicSharing: true,
  });

  // State Form tạo Link mới
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [scope, setScope] = useState(SHARE_SCOPE.VIEW_ONLY);
  const [requirePasscodeOnLink, setRequirePasscodeOnLink] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [newlyCreatedLink, setNewlyCreatedLink] = useState(null);

  // State Passcode Form
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [showPasscodeText, setShowPasscodeText] = useState(false);
  const [savingPasscode, setSavingPasscode] = useState(false);
  const [passcodeSuccessMsg, setPasscodeSuccessMsg] = useState("");
  const [passcodeErrorMsg, setPasscodeErrorMsg] = useState("");

  // State Xác nhận Thu hồi (Revoke Confirmation)
  const [linkToRevoke, setLinkToRevoke] = useState(null);
  const [revoking, setRevoking] = useState(false);

  // Copy Feedback
  const [copiedLinkId, setCopiedLinkId] = useState(null);

  // Lắng nghe phím Esc để đóng modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (linkToRevoke) {
          setLinkToRevoke(null);
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [linkToRevoke, onClose]);

  // Tải danh sách Links và Cài đặt bảo mật
  const loadShareData = useCallback(async () => {
    if (!meetingId) return;
    setLoadingLinks(true);
    setLoadError("");
    try {
      const [linksData, secData] = await Promise.all([
        getMeetingShareLinks(meetingId),
        getMeetingSecuritySettings(meetingId),
      ]);
      setLinks(linksData);
      setSecuritySettings(secData);
    } catch (err) {
      setLoadError("Không thể tải thông tin liên kết chia sẻ. Vui lòng thử lại.");
    } finally {
      setLoadingLinks(false);
    }
  }, [meetingId]);

  useEffect(() => {
    loadShareData();
  }, [loadShareData]);

  // Hành động: Tạo Link Mới
  const handleCreateLink = async (e) => {
    e?.preventDefault();
    if (!meetingId || !isOwner || creatingLink) return;
    setCreatingLink(true);
    setNewlyCreatedLink(null);
    try {
      const created = await createMeetingShareLink(meetingId, {
        expiresInDays: Number(expiresInDays) || null,
        scope,
        hasPasscode: requirePasscodeOnLink || securitySettings.isPasscodeProtected,
      });
      setNewlyCreatedLink(created);
      setLinks((prev) => [created, ...prev]);
    } catch (err) {
      alert("Lỗi khi tạo liên kết chia sẻ: " + (err.message || "Vui lòng thử lại"));
    } finally {
      setCreatingLink(false);
    }
  };

  // Hành động: Xác nhận Thu hồi Link
  const handleConfirmRevoke = async () => {
    if (!linkToRevoke || !meetingId || !isOwner || revoking) return;
    setRevoking(true);
    try {
      await revokeMeetingShareLink(meetingId, linkToRevoke.id);
      setLinks((prev) =>
        prev.map((l) =>
          l.id === linkToRevoke.id
            ? { ...l, isRevoked: true, status: SHARE_LINK_STATUS.REVOKED }
            : l
        )
      );
      setLinkToRevoke(null);
    } catch (err) {
      alert("Không thể thu hồi liên kết: " + (err.message || "Vui lòng thử lại"));
    } finally {
      setRevoking(false);
    }
  };

  // Hành động: Lưu Passcode mới
  const handleSavePasscode = async (e) => {
    e?.preventDefault();
    if (!meetingId || !isOwner || savingPasscode) return;
    setPasscodeErrorMsg("");
    setPasscodeSuccessMsg("");

    const clean = newPasscode.trim();
    if (clean.length < 4) {
      setPasscodeErrorMsg("Mật mã bảo vệ phải có tối thiểu 4 ký tự.");
      return;
    }

    if (clean !== confirmPasscode.trim()) {
      setPasscodeErrorMsg("Mật mã xác nhận không trùng khớp.");
      return;
    }

    setSavingPasscode(true);
    try {
      await updateMeetingPasscode(meetingId, clean);
      setSecuritySettings((prev) => ({
        ...prev,
        isPasscodeProtected: true,
        passcodeHint: `${clean.length} ký tự`,
      }));
      setPasscodeSuccessMsg("Đã cập nhật mật mã bảo vệ thành công!");
      setNewPasscode("");
      setConfirmPasscode("");
    } catch (err) {
      setPasscodeErrorMsg(err.message || "Không thể cập nhật mật mã.");
    } finally {
      setSavingPasscode(false);
    }
  };

  // Hành động: Xóa bỏ Passcode
  const handleRemovePasscode = async () => {
    if (!meetingId || !isOwner || savingPasscode) return;
    if (!window.confirm("Bạn có chắc chắn muốn hủy bảo vệ mật mã cho cuộc họp này?")) return;

    setSavingPasscode(true);
    setPasscodeErrorMsg("");
    setPasscodeSuccessMsg("");
    try {
      await removeMeetingPasscode(meetingId);
      setSecuritySettings((prev) => ({
        ...prev,
        isPasscodeProtected: false,
        passcodeHint: null,
      }));
      setPasscodeSuccessMsg("Đã xóa bỏ yêu cầu mật mã truy cập.");
    } catch (err) {
      setPasscodeErrorMsg(err.message || "Không thể xóa mật mã.");
    } finally {
      setSavingPasscode(false);
    }
  };

  // Tạo PIN ngẫu nhiên 6 số
  const handleGenerateRandomPin = () => {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    setNewPasscode(pin);
    setConfirmPasscode(pin);
  };

  // Sao chép Link an toàn
  const handleCopyLink = async (linkItem) => {
    try {
      await navigator.clipboard.writeText(linkItem.shareUrl);
      setCopiedLinkId(linkItem.id);
      setTimeout(() => setCopiedLinkId(null), 2000);
    } catch {
      // Fallback
    }
  };

  const passcodeStrength = evaluatePasscodeStrength(newPasscode);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn font-sans"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl bg-[#0c1324] border border-[#1e2a44] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-200">
        
        {/* MODAL HEADER */}
        <div className="px-6 py-4 border-b border-[#18233c] bg-[#080d19] flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
              <ShareIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 id="share-modal-title" className="text-sm sm:text-base font-bold text-white truncate">
                  Quản lý Liên kết & Passcode
                </h3>
                {isOwner ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Owner
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-300 border border-slate-600">
                    Chỉ xem
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5" title={fileName}>
                Cuộc họp: {fileName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#162035] transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex items-center px-6 border-b border-[#18233c] bg-[#090f1d] gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("links")}
            className={`py-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
              activeTab === "links"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <LinkIcon />
            <span>Liên kết công khai</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#18233c] text-slate-300 font-mono">
              {links.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("passcode")}
            className={`py-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
              activeTab === "passcode"
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <LockIcon />
            <span>Bảo mật Passcode</span>
            {securitySettings.isPasscodeProtected && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* MODAL CONTENT BODY */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* TAB 1: QUẢN LÝ LIÊN KẾT CHIA SẺ */}
          {activeTab === "links" && (
            <div className="space-y-5">
              {/* Cảnh báo nếu không phải Owner (4.1) */}
              {!isOwner && (
                <div className="p-3 rounded-xl bg-[#141b2e] border border-blue-500/30 text-xs text-slate-300 flex items-start gap-2.5">
                  <ShieldCheckIcon className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <p>
                    Bạn đang ở chế độ xem. Chỉ Chủ cuộc họp (Owner) mới có quyền tạo mới hoặc thu hồi liên kết công khai.
                  </p>
                </div>
              )}

              {/* KHỐI TẠO LINK MỚI (Dành riêng cho Owner) */}
              {isOwner && (
                <div className="bg-[#10172a] border border-[#1e2a44] rounded-2xl p-4 shadow-sm">
                  <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span>Tạo liên kết chia sẻ mới</span>
                  </h4>

                  <form onSubmit={handleCreateLink} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Thời hạn Link */}
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Thời hạn liên kết:</label>
                        <select
                          value={expiresInDays ?? "unlimited"}
                          onChange={(e) => setExpiresInDays(e.target.value === "unlimited" ? null : Number(e.target.value))}
                          className="w-full rounded-xl bg-[#0a1122] border border-[#1e2a44] px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 [color-scheme:dark] cursor-pointer"
                        >
                          <option value="1">24 giờ (1 ngày)</option>
                          <option value="7">7 ngày (Khuyên dùng)</option>
                          <option value="30">30 ngày (1 tháng)</option>
                          <option value="unlimited">Không thời hạn (Vĩnh viễn)</option>
                        </select>
                      </div>

                      {/* Quyền hạn (Scope) */}
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Quyền hạn truy cập:</label>
                        <select
                          value={scope}
                          onChange={(e) => setScope(e.target.value)}
                          className="w-full rounded-xl bg-[#0a1122] border border-[#1e2a44] px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 [color-scheme:dark] cursor-pointer"
                        >
                          <option value={SHARE_SCOPE.VIEW_ONLY}>Chỉ xem trực tuyến (An toàn)</option>
                          <option value={SHARE_SCOPE.ALLOW_DOWNLOAD}>Xem & Tải bản ghi âm / video</option>
                        </select>
                      </div>
                    </div>

                    {/* Tùy chọn yêu cầu Passcode */}
                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={requirePasscodeOnLink}
                          onChange={(e) => setRequirePasscodeOnLink(e.target.checked)}
                          className="rounded border-slate-700 text-blue-600 focus:ring-0"
                        />
                        <span>Yêu cầu mật mã (Passcode) khi mở liên kết này</span>
                      </label>

                      <button
                        type="submit"
                        disabled={creatingLink}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md shadow-blue-600/20 transition cursor-pointer active:scale-95"
                      >
                        {creatingLink ? "Đang tạo..." : "+ Tạo liên kết"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* THÔNG BÁO LINK VỪA TẠO MỚI */}
              {newlyCreatedLink && (
                <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold flex items-center gap-1.5">
                      <ShieldCheckIcon className="w-4 h-4 text-emerald-400" />
                      <span>Liên kết chia sẻ mới đã sẵn sàng:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyLink(newlyCreatedLink)}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-semibold transition"
                    >
                      {copiedLinkId === newlyCreatedLink.id ? "✓ Đã sao chép" : "Sao chép Link"}
                    </button>
                  </div>
                  <p className="font-mono text-[11px] text-slate-300 truncate bg-[#06101e] p-2 rounded-lg border border-emerald-500/20 select-all">
                    {newlyCreatedLink.shareUrl}
                  </p>
                </div>
              )}

              {/* DANH SÁCH CÁC LIÊN KẾT ĐÃ TẠO */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
                  <span>Danh sách liên kết đã cấp ({links.length})</span>
                  <button
                    type="button"
                    onClick={loadShareData}
                    className="text-[11px] text-blue-400 hover:text-blue-300"
                  >
                    Làm mới
                  </button>
                </h4>

                {loadingLinks ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    Đang tải danh sách liên kết...
                  </div>
                ) : loadError ? (
                  <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 text-red-200 text-xs text-center">
                    <p>{loadError}</p>
                    <button
                      type="button"
                      onClick={loadShareData}
                      className="mt-2 px-3 py-1 bg-red-600 text-white rounded-lg text-xs"
                    >
                      Thử lại
                    </button>
                  </div>
                ) : links.length === 0 ? (
                  <div className="py-8 text-center bg-[#0a0f1d] rounded-2xl border border-[#1b2640] p-6">
                    <LinkIcon className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">Chưa có liên kết chia sẻ nào được tạo.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {links.map((link) => {
                      const isRevoked = link.isRevoked || link.status === SHARE_LINK_STATUS.REVOKED;
                      const isExpired = link.isExpired || link.status === SHARE_LINK_STATUS.EXPIRED;
                      const isActive = !isRevoked && !isExpired;

                      return (
                        <div
                          key={link.id}
                          className={`p-3.5 rounded-2xl border transition flex flex-col gap-2.5 ${
                            isActive
                              ? "bg-[#0d1629] border-[#1e2a44] hover:border-blue-500/40"
                              : isRevoked
                                ? "bg-red-950/20 border-red-500/25 opacity-70"
                                : "bg-[#080d19] border-[#18233c] opacity-70"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              {/* Trạng thái Badge */}
                              {isActive && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  ● Đang hoạt động
                                </span>
                              )}
                              {isExpired && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                  Hết hạn
                                </span>
                              )}
                              {isRevoked && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                                  Đã thu hồi
                                </span>
                              )}

                              {/* Scope Badge */}
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#162238] text-slate-300 border border-slate-700">
                                {link.scopeLabel || link.scope}
                              </span>

                              {link.hasPasscode && (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center gap-1">
                                  <LockIcon className="w-3 h-3" />
                                  <span>Cần Passcode</span>
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-400">
                              {link.accessCount} lượt truy cập
                            </div>
                          </div>

                          {/* Link URL box */}
                          <div className="flex items-center gap-2">
                            <input
                              readOnly
                              value={link.shareUrl}
                              className={`flex-1 min-w-0 bg-[#070c18] border border-[#162238] px-2.5 py-1.5 text-xs font-mono rounded-lg outline-none select-all ${
                                isRevoked ? "line-through text-slate-500" : "text-slate-300"
                              }`}
                            />
                            
                            <button
                              type="button"
                              onClick={() => handleCopyLink(link)}
                              disabled={isRevoked}
                              className="px-3 py-1.5 bg-[#142038] hover:bg-[#1a2d52] disabled:opacity-40 text-slate-200 text-xs font-semibold rounded-lg border border-[#223356] transition shrink-0 cursor-pointer"
                            >
                              {copiedLinkId === link.id ? "Đã chép" : "Sao chép"}
                            </button>

                            {/* Nút Thu hồi link (Chỉ hiển thị khi active và là owner) */}
                            {isActive && isOwner && (
                              <button
                                type="button"
                                onClick={() => setLinkToRevoke(link)}
                                className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 text-xs font-semibold rounded-lg transition shrink-0 cursor-pointer"
                              >
                                Thu hồi
                              </button>
                            )}
                          </div>

                          <div className="text-[10px] text-slate-500 flex items-center justify-between">
                            <span>Tạo lúc: {new Date(link.createdAt).toLocaleDateString()}</span>
                            <span>
                              {link.expiresAt
                                ? `Hết hạn: ${new Date(link.expiresAt).toLocaleDateString()}`
                                : "Thời hạn: Vô thời hạn"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: QUẢN LÝ PASSCODE BẢO MẬT (TR02, 2.2, 4.2) */}
          {activeTab === "passcode" && (
            <div className="space-y-5">
              <div className="bg-[#10172a] border border-[#1e2a44] rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-400 shrink-0">
                      <LockIcon />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Mật mã bảo vệ cuộc họp</h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Yêu cầu khách phải nhập mật mã (PIN) để mở khóa nội dung và phụ đề
                      </p>
                    </div>
                  </div>

                  {/* Trạng thái hiện tại */}
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                      securitySettings.isPasscodeProtected
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : "bg-slate-500/15 text-slate-400 border-slate-700"
                    }`}
                  >
                    {securitySettings.isPasscodeProtected ? "Đã bật mật mã" : "Chưa bật"}
                  </span>
                </div>

                {/* TR02 / 2.2: Không hiển thị lại mật mã cũ, masked dạng •••••••• */}
                {securitySettings.isPasscodeProtected && (
                  <div className="p-3 rounded-xl bg-[#091124] border border-[#1b2a47] text-xs text-slate-300 flex items-center justify-between">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Mật mã hiện tại:</span>
                      <span className="font-mono text-amber-300 text-sm tracking-widest font-bold">
                        ••••••••
                      </span>
                    </div>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={handleRemovePasscode}
                        disabled={savingPasscode}
                        className="px-3 py-1 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        Gỡ bỏ mật mã
                      </button>
                    )}
                  </div>
                )}

                {/* Form Đặt / Đổi Passcode mới */}
                {isOwner && (
                  <form onSubmit={handleSavePasscode} className="space-y-3.5 pt-3 border-t border-[#18233c]">
                    <h5 className="text-xs font-bold text-slate-200">
                      {securitySettings.isPasscodeProtected ? "Đổi mật mã mới:" : "Thiết lập mật mã mới:"}
                    </h5>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Mật mã mới (4-16 ký tự):</label>
                        <div className="relative">
                          <input
                            type={showPasscodeText ? "text" : "password"}
                            value={newPasscode}
                            onChange={(e) => setNewPasscode(e.target.value)}
                            placeholder="Nhập mật mã"
                            maxLength={16}
                            className="w-full rounded-xl bg-[#0a1122] border border-[#1e2a44] px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 font-mono tracking-wider"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPasscodeText(!showPasscodeText)}
                            className="absolute right-2.5 top-2 text-[11px] text-slate-400 hover:text-white"
                          >
                            {showPasscodeText ? "Ẩn" : "Hiện"}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Xác nhận lại mật mã:</label>
                        <input
                          type={showPasscodeText ? "text" : "password"}
                          value={confirmPasscode}
                          onChange={(e) => setConfirmPasscode(e.target.value)}
                          placeholder="Nhập lại mật mã"
                          maxLength={16}
                          className="w-full rounded-xl bg-[#0a1122] border border-[#1e2a44] px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 font-mono tracking-wider"
                        />
                      </div>
                    </div>

                    {/* Passcode Strength Meter */}
                    {newPasscode && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Độ an toàn mật mã:</span>
                          <span className={`font-semibold ${passcodeStrength.colorClass.split(" ")[0]}`}>
                            {passcodeStrength.label}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#162035] rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${passcodeStrength.colorClass.split(" ")[1]}`}
                            style={{ width: `${(passcodeStrength.score / 4) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {passcodeErrorMsg && (
                      <p className="text-xs text-red-400 font-medium">{passcodeErrorMsg}</p>
                    )}

                    {passcodeSuccessMsg && (
                      <p className="text-xs text-emerald-400 font-medium">{passcodeSuccessMsg}</p>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={handleGenerateRandomPin}
                        className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2"
                      >
                        Tạo PIN 6 số ngẫu nhiên
                      </button>

                      <button
                        type="submit"
                        disabled={savingPasscode || !newPasscode}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-500/20 transition cursor-pointer active:scale-95"
                      >
                        {savingPasscode ? "Đang lưu..." : "Lưu mật mã"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Tiêu chuẩn an ninh TR02 / 4.2 */}
                <div className="p-3 rounded-xl bg-[#090f1e] border border-[#17223b] text-[11px] text-slate-400 flex items-start gap-2">
                  <ShieldCheckIcon className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <p>
                    <strong>Nguyên tắc bảo mật SmartRec:</strong> Mật mã sau khi lưu được băm an toàn và không bao giờ hiển thị lại trên giao diện. Mật mã không lưu trong localStorage trình duyệt để bảo vệ tính bí mật của cuộc họp.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="px-6 py-3.5 border-t border-[#18233c] bg-[#080d19] flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Sprint 4 · Public Access Control
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#141e33] hover:bg-[#1a2744] text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer active:scale-95"
          >
            Đóng
          </button>
        </div>

        {/* HỘP THOẠI XÁC NHẬN THU HỒI LINK (Revoke Confirmation Modal) */}
        {linkToRevoke && (
          <div
            role="alertdialog"
            aria-modal="true"
            className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn"
          >
            <div className="w-full max-w-md bg-[#0f172a] border border-red-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-red-400">
                <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0">
                  <AlertOctagonIcon />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Xác nhận thu hồi liên kết?</h4>
                  <p className="text-xs text-slate-400 mt-0.5">Hành động này không thể hoàn tác</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Người nhận sẽ bị vô hiệu hóa quyền truy cập ngay lập tức khi sử dụng liên kết này:
              </p>

              <div className="p-2 bg-[#080c16] rounded-lg border border-[#1b2640] text-[11px] font-mono text-slate-400 truncate">
                {linkToRevoke.shareUrl}
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setLinkToRevoke(null)}
                  disabled={revoking}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRevoke}
                  disabled={revoking}
                  className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-md shadow-red-600/30 transition cursor-pointer"
                >
                  {revoking ? "Đang thu hồi..." : "Xác nhận thu hồi"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
