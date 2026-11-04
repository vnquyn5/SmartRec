import React, { useState, useEffect } from "react";
import { ShareIcon } from "../common/icons";

export default function ShareMeetingModal({ meeting, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copiedWithPasscode, setCopiedWithPasscode] = useState(false);
  const [enablePasscode, setEnablePasscode] = useState(false);
  const [passcode, setPasscode] = useState("");

  const meetingId = meeting?.id;
  const shareUrl = `${window.location.origin}/shared/meeting/${meetingId}`;

  useEffect(() => {
    if (!meetingId) return;
    try {
      localStorage.setItem(`public_meeting_${meetingId}`, JSON.stringify(meeting));
    } catch {}
    const stored = localStorage.getItem(`meeting_passcode_${meetingId}`);
    if (stored) {
      setEnablePasscode(true);
      setPasscode(stored);
    } else {
      setEnablePasscode(false);
      setPasscode(String(Math.floor(100000 + Math.random() * 900000)));
    }
  }, [meetingId, meeting]);

  const handleTogglePasscode = (checked) => {
    setEnablePasscode(checked);
    if (checked) {
      const code = passcode || String(Math.floor(100000 + Math.random() * 900000));
      setPasscode(code);
      localStorage.setItem(`meeting_passcode_${meetingId}`, code);
    } else {
      localStorage.removeItem(`meeting_passcode_${meetingId}`);
    }
  };

  const handlePasscodeChange = (newCode) => {
    const sanitized = newCode.replace(/\s+/g, "").slice(0, 8);
    setPasscode(sanitized);
    if (enablePasscode) {
      localStorage.setItem(`meeting_passcode_${meetingId}`, sanitized);
    }
  };

  const generateRandomPin = () => {
    const randomPin = String(Math.floor(100000 + Math.random() * 900000));
    setPasscode(randomPin);
    if (enablePasscode) {
      localStorage.setItem(`meeting_passcode_${meetingId}`, randomPin);
    }
  };

  const copyUrlOnly = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const copyUrlAndPasscode = async () => {
    try {
      const fileName = meeting?.fileName || meeting?.title || "Cuộc họp SmartRec";
      const message = `Cuộc họp: ${fileName}\nLink xem: ${shareUrl}\nMật mã truy cập (Passcode): ${passcode}`;
      await navigator.clipboard.writeText(message);
      setCopiedWithPasscode(true);
      setTimeout(() => setCopiedWithPasscode(false), 2000);
    } catch {
      setCopiedWithPasscode(false);
    }
  };

  if (!meeting) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md animate-fadeIn"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f172a] p-6 shadow-2xl shadow-black/60 relative overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-meeting-title"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
              <ShareIcon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs uppercase font-semibold tracking-wider text-blue-400">
                Chia sẻ cuộc họp
              </p>
              <h2 id="share-meeting-title" className="text-base font-bold text-white truncate max-w-sm">
                {meeting.fileName || meeting.title || "Cuộc họp"}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition text-xl leading-none p-1 rounded-lg hover:bg-slate-800"
            aria-label="Đóng"
          >
            ×
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Link xem công khai (Dành cho khách & đối tác)
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-[#17223b] p-1.5 focus-within:border-blue-500 transition">
              <input
                readOnly
                value={shareUrl}
                className="min-w-0 flex-1 bg-transparent px-2.5 text-xs text-slate-200 outline-none select-all"
                aria-label="Link chia sẻ"
              />
              <button
                type="button"
                onClick={copyUrlOnly}
                className="shrink-0 rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white transition shadow-sm"
              >
                {copied ? "Đã sao chép" : "Sao chép"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Người nhận có thể nghe lại audio/video và đọc phụ đề tương tác mà không cần tài khoản.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#131c31] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <div>
                  <span className="text-xs font-bold text-white block">
                    Bảo vệ liên kết bằng mật mã (Passcode)
                  </span>
                  <span className="text-[11px] text-slate-400 block">
                    Khách phải nhập đúng mã để xem nội dung
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enablePasscode}
                  onChange={(e) => handleTogglePasscode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {enablePasscode && (
              <div className="pt-2 border-t border-slate-700/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={passcode}
                    onChange={(e) => handlePasscodeChange(e.target.value)}
                    placeholder="Nhập 4-8 ký tự"
                    maxLength={8}
                    className="w-full bg-[#1b2744] border border-slate-600 rounded-lg px-3 py-1.5 text-sm font-mono text-center tracking-widest text-amber-300 font-bold outline-none focus:border-amber-400 transition"
                  />
                </div>
                <button
                  type="button"
                  onClick={generateRandomPin}
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-600 transition"
                >
                  Tạo mã ngẫu nhiên
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition"
          >
            <span>Mở thử giao diện khách</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>

          <div className="flex items-center gap-2 ml-auto">
            {enablePasscode && (
              <button
                type="button"
                onClick={copyUrlAndPasscode}
                className="rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 px-3.5 py-2 text-xs font-semibold transition"
              >
                {copiedWithPasscode ? "Đã chép link & mã" : "Chép link & Mật mã"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

