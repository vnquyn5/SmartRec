import React from 'react';

function SpinnerIcon({ className = "w-4 h-4", ...props }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CheckCircleIcon({ className = "w-5 h-5", ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertCircleIcon({ className = "w-5 h-5", ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export default function AudioAiStatus({ status, onRetry }) {
  if (status === 'processing') {
    return (
      <div className="w-full bg-[#0c101d] border border-[#2563eb]/40 rounded-2xl p-4 shadow-lg flex items-center justify-between font-sans">
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-[#172554] border border-[#2563eb]/50 flex items-center justify-center text-[#38bdf8] shrink-0 shadow-md">
            <SpinnerIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white text-sm font-bold">Audio AI</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#1e3a8a] text-[#60a5fa]">
                Đang xử lý
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Hệ thống đang phân tích giọng nói. Thông tin Speaker sẽ tự động xuất hiện khi hoàn thành.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'completed' || status === 'empty') {
    return (
      <div className="w-full bg-[#0c101d] border border-[#10b981]/40 rounded-2xl p-4 shadow-lg flex items-center justify-between font-sans">
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-[#064e3b] border border-[#10b981]/50 flex items-center justify-center text-[#34d399] shrink-0 shadow-md">
            <CheckCircleIcon />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white text-sm font-bold">Audio AI</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#064e3b] text-[#34d399]">
                Hoàn tất
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Đã nhận diện thành công các Speaker và đoạn hội thoại trong cuộc họp.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="w-full bg-[#0c101d] border border-[#ef4444]/40 rounded-2xl p-4 shadow-lg flex items-center justify-between font-sans">
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-[#450a0a] border border-[#ef4444]/50 flex items-center justify-center text-[#f87171] shrink-0 shadow-md">
            <AlertCircleIcon />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white text-sm font-bold">Audio AI</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#450a0a] text-[#f87171]">
                Xử lý thất bại
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Không thể xử lý bản ghi âm này. Vui lòng kiểm tra lại định dạng file hoặc thử lại.
            </p>
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded-xl bg-[#ef4444] hover:bg-[#dc2626] text-white text-xs font-semibold shadow-md transition-colors shrink-0"
          >
            Thử lại
          </button>
        )}
      </div>
    );
  }

  return null;
}
