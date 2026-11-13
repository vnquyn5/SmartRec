import React, { useEffect, useState } from 'react';

export default function ShareMeetingModal({ meeting, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const shareUrl = `${window.location.origin}/meeting/${meeting?.id || ''}`;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopied(false);
      setCopyError('Không thể sao chép link. Vui lòng sao chép thủ công.');
    }
  };

  if (!meeting) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#101624] p-6 shadow-2xl shadow-black/50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-share-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Chia sẻ cuộc họp</p>
            <h2 id="meeting-share-title" className="mt-1 text-lg font-bold text-white">Link chia sẻ file</h2>
          </div>
          <button type="button" onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-white" aria-label="Đóng">×</button>
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-slate-700 bg-[#171d31] p-2">
          <input
            readOnly
            value={shareUrl}
            onFocus={(event) => event.target.select()}
            className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-300 outline-none"
            aria-label="Link chia sẻ"
          />
          <button type="button" onClick={copyShareUrl} className="shrink-0 rounded-md bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-400">
            {copied ? 'Đã sao chép' : 'Sao chép'}
          </button>
        </div>
        {copyError && <p role="alert" className="mt-2 text-xs text-amber-200">{copyError}</p>}
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:border-slate-500">Đóng</button>
        </div>
      </div>
    </div>
  );
}
