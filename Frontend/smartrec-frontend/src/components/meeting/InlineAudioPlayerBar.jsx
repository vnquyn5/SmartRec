import React from 'react';

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function InlineAudioPlayerBar({
  currentTime = 0,
  duration = 4680,
  isPlaying = false,
  playbackRate = 1,
  isMuted = false,
  onTogglePlay,
  onSeek,
  onCycleSpeed,
  onRewind5,
  onToggleMute,
  onDownload,
  downloading = false,
}) {
  return (
    <div className="flex items-center gap-2.5 sm:gap-3 bg-[#0c1322] border border-[#1e2a44] rounded-full px-3.5 py-1.5 shadow-md select-none shrink-0">
      {/* Play / Pause Circular Button */}
      <button
        type="button"
        onClick={onTogglePlay}
        className="w-7 h-7 rounded-full bg-white text-slate-900 flex items-center justify-center hover:bg-slate-200 transition shadow shrink-0"
        title={isPlaying ? "Tạm dừng" : "Phát"}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
        )}
      </button>

      {/* Time Display: 00:00:00 / 01:18:00 */}
      <span className="font-mono text-xs text-slate-300 font-medium whitespace-nowrap">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {/* Scrubber / Progress Bar */}
      <input
        type="range"
        min="0"
        max={duration || 100}
        value={currentTime}
        onChange={(e) => onSeek?.(Number(e.target.value))}
        className="w-24 sm:w-36 md:w-52 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white"
        aria-label="Tiến trình phát âm thanh"
      />

      {/* Speed Button (1x) */}
      <button
        type="button"
        onClick={onCycleSpeed}
        className="text-xs font-semibold text-slate-300 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10 transition"
        title="Tốc độ phát"
      >
        {playbackRate}x
      </button>

      {/* Rewind 5s Button (⟲ 5) */}
      <button
        type="button"
        onClick={onRewind5}
        className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition"
        title="Lùi lại 5 giây"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <text x="12" y="15.5" fontSize="7.5" fontWeight="bold" textAnchor="middle" fill="currentColor" stroke="none">5</text>
        </svg>
      </button>

      {/* Volume / Mute Button */}
      <button
        type="button"
        onClick={onToggleMute}
        className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition"
        title={isMuted ? "Bật âm thanh" : "Tắt tiếng"}
      >
        {isMuted ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>

      {/* Download Button */}
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition disabled:opacity-50"
        title="Tải xuống tệp"
      >
        {downloading ? (
          <svg className="animate-spin w-4 h-4 text-sky-400" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
