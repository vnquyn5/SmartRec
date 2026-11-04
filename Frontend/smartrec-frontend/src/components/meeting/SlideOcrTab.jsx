import React from 'react';

function formatTimestamp(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function SlideOcrTab({ slides = [], status = 'NOT_PROCESSED', loading = false, error = '', onSeek }) {
  const hasSlides = slides.length > 0;
  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col mb-1">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
          <h2 className="text-sm font-bold text-white tracking-wide">Slide Keyframes & OCR</h2>
        </div>
        <p className="text-[11px] text-slate-400 mt-1 pl-3.5">
          {hasSlides ? `${slides.length} slide${slides.length === 1 ? '' : 's'} được lưu` : 'Nội dung OCR thực tế từ Backend'}
        </p>
      </div>

      {loading && <p className="text-sm text-slate-400 text-center py-8">Đang tải kết quả OCR…</p>}
      {!loading && error && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-5 py-6 text-sm text-amber-200">{error}</p>}
      {!loading && !error && !hasSlides && (
        <div className="rounded-xl border border-dashed border-[#263451] bg-[#0d1526] px-5 py-8 text-center">
          {status === 'NO_SLIDES_DETECTED' ? (
            <>
              <p className="text-sm font-semibold text-slate-200">No slides detected</p>
              <p className="mt-1 text-xs text-slate-400">Video đã xử lý xong và không phát hiện slide hợp lệ.</p>
            </>
          ) : status === 'FAILED' ? (
            <>
              <p className="text-sm font-semibold text-rose-200">Không thể hoàn tất OCR</p>
              <p className="mt-1 text-xs text-slate-400">Pipeline thất bại tại OUTPUT; không có kết quả OCR hoàn chỉnh.</p>
            </>
          ) : status === 'NOT_APPLICABLE' ? (
            <p className="text-sm text-slate-400">OCR chỉ áp dụng cho video.</p>
          ) : (
            <p className="text-sm text-slate-400">OCR chưa được xử lý hoặc chưa có kết quả để hiển thị.</p>
          )}
        </div>
      )}
      {!loading && !error && hasSlides && slides.map((slide) => (
        <article key={slide.slideId} className="w-full bg-[#0d1526] border border-[#1b2742] rounded-2xl p-4 flex gap-4 shadow-sm">
          <button
            type="button"
            onClick={() => onSeek?.(Number(slide.timestampMs) / 1000)}
            className="relative w-28 h-20 rounded-xl bg-[#080d19] border border-[#1a253d] shrink-0 flex items-center justify-center text-slate-500 hover:text-[#38bdf8]"
            aria-label={`Đi tới ${formatTimestamp(slide.timestampMs)}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="m10 9 5 3-5 3z" />
            </svg>
            <span className="absolute bottom-1 left-1.5 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-200">
              {formatTimestamp(slide.timestampMs)}
            </span>
          </button>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-slate-100">{slide.topic || `Slide · ${formatTimestamp(slide.timestampMs)}`}</h4>
            <p className="text-xs text-slate-300 mt-2 leading-relaxed whitespace-pre-wrap break-words">
              {slide.ocrText?.trim() || 'Không có văn bản OCR trên slide này.'}
            </p>
            {Array.isArray(slide.keywords) && slide.keywords.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">Từ khóa: {slide.keywords.join(', ')}</p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
