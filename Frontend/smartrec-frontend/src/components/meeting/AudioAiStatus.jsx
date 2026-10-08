import React from 'react';

function SpinnerIcon({ className = "w-3 h-3", ...props }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CheckCircleIcon({ className = "w-4 h-4", ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertCircleIcon({ className = "w-4 h-4", ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export default function AudioAiStatus({ status, onRetry, onStartProcessing, startingProcess = false, errorMessage, retrying = false }) {
  if (status === 'unprocessed') {
    return (
      <div className="w-full bg-[#0c101d] border border-slate-600/40 rounded-lg p-2.5 shadow-sm flex items-center justify-between font-sans">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-white text-[13px] font-bold">Audio AI</span>
            <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-200">Chưa xử lý</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">Cuộc họp chưa được xử lý AI.</p>
        </div>
        {onStartProcessing && <button type="button" onClick={onStartProcessing} disabled={startingProcess} className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-[11px] font-semibold disabled:opacity-50">{startingProcess ? 'Đang bắt đầu…' : 'Xử lý ngay'}</button>}
      </div>
    );
  }
  if (status === 'queued') {
    return (
      <div className="w-full bg-[#0c101d] border border-slate-600/40 rounded-lg p-2.5 shadow-sm flex items-center gap-2.5 font-sans">
        <div className="w-7 h-7 rounded-md bg-slate-800 border border-slate-600/50 flex items-center justify-center text-slate-300 shrink-0">…</div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-white text-[13px] font-bold">Audio AI</span>
            <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-200">Chờ xử lý</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">Job đang chờ worker xử lý.</p>
        </div>
      </div>
    );
  }

  if (status === 'processing') {
    return (
      <div className="w-full bg-[#0c101d] border border-[#2563eb]/40 rounded-lg p-2.5 shadow-sm flex items-center justify-between font-sans">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[#172554] border border-[#2563eb]/50 flex items-center justify-center text-[#38bdf8] shrink-0 shadow-sm">
            <SpinnerIcon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-white text-[13px] font-bold">Audio AI</span>
              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-[#1e3a8a] text-[#60a5fa]">
                Đang xử lý
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">
              Hệ thống đang phân tích giọng nói. Thông tin Speaker sẽ tự động xuất hiện khi hoàn thành.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'completed' || status === 'empty') {
    return (
      <div className="w-full bg-[#0c101d] border border-[#10b981]/40 rounded-lg p-2.5 shadow-sm flex items-center justify-between font-sans">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[#064e3b] border border-[#10b981]/50 flex items-center justify-center text-[#34d399] shrink-0 shadow-sm">
            <CheckCircleIcon />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-white text-[13px] font-bold">Audio AI</span>
              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-[#064e3b] text-[#34d399]">
                Hoàn tất
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">
              {status === 'empty' ? 'Đã xử lý xong. Không phát hiện đoạn hội thoại nào.' : 'Đã nhận diện thành công các Speaker và đoạn hội thoại trong cuộc họp.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="w-full bg-[#0c101d] border border-[#ef4444]/40 rounded-lg p-2.5 shadow-sm flex items-center justify-between font-sans">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[#450a0a] border border-[#ef4444]/50 flex items-center justify-center text-[#f87171] shrink-0 shadow-sm">
            <AlertCircleIcon />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-white text-[13px] font-bold">Audio AI</span>
              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-[#450a0a] text-[#f87171]">
                Xử lý thất bại
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">
              {errorMessage || 'Không thể xử lý bản ghi âm này. Vui lòng thử lại.'}
            </p>
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="px-3 py-1.5 rounded-lg bg-[#ef4444] hover:bg-[#dc2626] text-white text-[11px] font-semibold shadow-sm transition-colors shrink-0"
          >
            {retrying ? 'Đang gửi…' : 'Thử lại'}
          </button>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div role="alert" className="w-full bg-[#0c101d] border border-[#f59e0b]/40 rounded-lg p-2.5 shadow-sm font-sans">
        <span className="text-[13px] font-bold text-white">Không thể tải trạng thái Audio AI</span>
        <p className="text-[11px] text-amber-200 mt-1">{errorMessage || 'Kiểm tra kết nối hoặc đăng nhập rồi tải lại trang.'}</p>
      </div>
    );
  }

  return null;
}
