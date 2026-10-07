import React, { useState } from 'react';

export default function MeetingVideoPlayer({ currentTime = '12:45', duration = '28:30' }) {
  const [isPlaying, setIsPlaying] = useState(false);

  // Attendees grid matching the Figma screenshot (9 video call boxes)
  const attendees = [
    { id: 1, name: 'Alex Nguyen', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80' },
    { id: 2, name: 'Speaker A', img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80' },
    { id: 3, name: 'Speaker B', img: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80' },
    { id: 4, name: 'Sarah Chen', img: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80' },
    { id: 5, name: 'Anh Quyen', img: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80' },
    { id: 6, name: 'Chi Lan', img: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80' },
    { id: 7, name: 'Speaker C', img: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=200&q=80' },
    { id: 8, name: 'Marcus Brody', img: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=200&q=80' },
    { id: 9, name: 'Speaker D', img: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80' },
  ];

  const parseSeconds = (timeStr) => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  };

  const currentSec = parseSeconds(currentTime);
  const totalSec = parseSeconds(duration) || 1710;
  const progressPercent = Math.min(100, Math.max(0, (currentSec / totalSec) * 100));

  return (
    <div className="w-full bg-[#080d1a] border border-[#1b2640] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
      {/* 3x3 Video Attendees Grid matching Figma */}
      <div className="relative aspect-video w-full bg-black flex items-center justify-center select-none overflow-hidden">
        <div className="w-[80%] aspect-video p-1.5 grid grid-cols-3 grid-rows-3 gap-2">
          {attendees.map((person) => (
            <div key={person.id} className="relative rounded-xl overflow-hidden bg-[#111928] border border-white/5 group">
              <img
                src={person.img}
                alt={person.name}
                className="w-full h-full object-cover brightness-90 group-hover:brightness-100 transition"
              />
              <div className="absolute bottom-1.5 left-2 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] text-white/90 font-medium">
                {person.name}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Video Controls Bar */}
      <div className="px-4 py-3 bg-[#0a1122] border-t border-[#1a253d] flex flex-col gap-2">
        {/* Progress Bar with Blue Scrubber */}
        <div className="w-full flex items-center gap-2 group cursor-pointer py-1">
          <div className="relative w-full h-1 bg-[#1e2a44] rounded-full">
            <div
              className="absolute left-0 top-0 bottom-0 bg-[#38bdf8] rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-md scale-0 group-hover:scale-100 transition-transform"></div>
            </div>
          </div>
        </div>

        {/* Action Controls & Timestamps */}
        <div className="flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="text-slate-300 hover:text-white transition"
              aria-label="Play"
            >
              {isPlaying ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Next segment */}
            <button type="button" className="text-slate-400 hover:text-white transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>

            {/* Volume */}
            <button type="button" className="text-slate-400 hover:text-white transition">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
              </svg>
            </button>

            {/* Time Indicator */}
            <span className="font-mono text-[11px] text-slate-300 ml-1">
              {currentTime} / {duration}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Speed Pill */}
            <span className="px-2 py-0.5 text-[10px] font-semibold bg-[#18233c] text-slate-300 rounded border border-[#27375a] hover:bg-[#202e4e] cursor-pointer">
              1.0x
            </span>

            {/* Subtitles CC */}
            <button type="button" className="text-slate-400 hover:text-white transition">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 01-1 1h-3a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1z" />
              </svg>
            </button>

            {/* Fullscreen */}
            <button type="button" className="text-slate-400 hover:text-white transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
