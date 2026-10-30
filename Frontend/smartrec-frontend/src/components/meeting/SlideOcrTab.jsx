import React from 'react';

export default function SlideOcrTab({ frames = [], onSeek }) {
  const formatTime = (ms) => {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
      .map((part) => String(part).padStart(2, '0')).join(':');
  };
  const slides = frames.map((frame, index) => ({
    id: `${index}-${frame.timestampMs}`,
    timestampMs: frame.timestampMs,
    time: formatTime(frame.timestampMs),
    title: `Keyframe ${index + 1}`,
    desc: frame.text || '',
    iconType: 'play',
    badges: [],
  }));

  const renderIcon = (type) => {
    switch (type) {
      case 'chart':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        );
      case 'calendar':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        );
      case 'alert':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
      case 'users':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        );
      default:
        return (
          <div className="w-8 h-8 rounded-full bg-[#2563eb] flex items-center justify-center text-white shadow-md">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        );
    }
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Tab Header Title */}
      <div className="flex flex-col mb-1">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block"></span>
          <h2 className="text-sm font-bold text-white tracking-wide">
            Slide Keyframes & OCR
          </h2>
        </div>
        <p className="text-[11px] text-slate-400 mt-1 pl-3.5">
          {slides.length} keyframes · OCR Tesseract vie+eng
        </p>
      </div>

      {/* Cards List */}
      {!slides.length ? <p className="text-sm text-slate-400">Chưa có kết quả OCR cho video này.</p> : <div className="flex flex-col gap-3">
        {slides.map((slide) => (
          <div
            key={slide.id}
            className="w-full bg-[#0d1526] hover:bg-[#111a30] border border-[#1b2742] hover:border-[#2a3b63] rounded-2xl p-4 flex gap-4 transition shadow-sm"
          >
            {/* Thumbnail Preview with Timestamp */}
            <div className="relative w-28 h-20 rounded-xl bg-[#080d19] border border-[#1a253d] shrink-0 flex items-center justify-center overflow-hidden">
              {renderIcon(slide.iconType)}
              <button type="button" onClick={() => onSeek?.((Number(slide.timestampMs) || 0) / 1000)} className="absolute bottom-1 left-1.5 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-200">
                {slide.time}
              </button>
            </div>

            {/* Info and OCR text */}
            <div className="flex-1 flex flex-col justify-between min-w-0">
              <div>
                <h4 className="text-sm font-bold text-slate-100 truncate">
                  {slide.title}
                </h4>
                <p className="text-xs text-slate-400 mt-1 leading-snug line-clamp-2">
                  {slide.desc}
                </p>
              </div>

              {/* Badges / Metrics */}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {slide.badges.map((b, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#131f38] border border-[#203157] text-[10px] text-slate-300"
                  >
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                      {b.label}
                    </span>
                    <span className="font-bold text-white">{b.value}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}
