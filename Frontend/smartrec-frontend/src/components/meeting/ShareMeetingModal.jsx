import React, { useState } from 'react';

export default function ShareMeetingModal({ isOpen, onClose, meeting }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !meeting) return null;

  const shareUrl = `${window.location.origin}/meeting/${meeting.id || ''}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[#233357] bg-[#0c1426] p-6 shadow-2xl text-slate-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-meeting-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
              Chia sẻ cuộc họp
            </span>
            <h2 id="share-meeting-title" className="mt-1 text-base font-bold text-white">
              {meeting.fileName || meeting.title || "Cuộc họp"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none p-1"
            aria-label="Đóng"
          >
            ×
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          Bất kỳ ai có đường liên kết này đều có thể truy cập để xem biên bản và thông tin phân tích AI của cuộc họp.
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#223152] bg-[#090f1d] p-2">
          <input
            type="text"
            readOnly
            value={shareUrl}
            className="w-full bg-transparent px-2 text-xs text-slate-200 outline-none select-all font-mono"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white transition shrink-0"
          >
            {copied ? "✓ Đã sao chép" : "Sao chép"}
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#141d33] hover:bg-[#1a2642] border border-[#233357] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
