import React, { useState } from 'react';

function UsersIcon({ className = "w-4 h-4", ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CheckIcon({ className = "w-3 h-3", ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function EditPencilIcon({ className = "w-3.5 h-3.5", ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

const DOT_COLORS = ['#2563eb', '#818cf8', '#f97316', '#10b981'];

export default function SpeakerList({
  status = 'completed',
  speakers = [],
  selectedSpeakerId,
  onSelectSpeaker,
  onOpenRename
}) {
  // Checkbox selections for the sidebar rows
  const [checkedMap, setCheckedMap] = useState({
    '1': true,
    '2': true
  });

  const toggleCheck = (id) => {
    setCheckedMap(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Ensure at least 4 speakers are rendered to showcase the complete Figma layout
  const displaySpeakers = speakers.length >= 4
    ? speakers
    : [
        ...speakers,
        ...(speakers.length < 3 ? [{ id: '3', originalLabel: 'Speaker 3', name: '', segments: [] }] : []),
        ...(speakers.length < 4 ? [{ id: '4', originalLabel: 'Speaker 4', name: '', segments: [] }] : []),
      ];

  return (
    <div className="w-full bg-[#0c101c] border border-[#1e2640] rounded-2xl shadow-xl overflow-hidden font-sans select-none">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-[#1b2542] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UsersIcon className="w-4 h-4 text-[#38bdf8]" />
          <span className="text-[11px] font-bold text-[#8e9bb3] uppercase tracking-widest">
            SPEAKERS
          </span>
        </div>
        <span className="w-6 h-6 rounded-full bg-[#1b2542] text-[#38bdf8] flex items-center justify-center text-xs font-semibold">
          {displaySpeakers.length}
        </span>
      </div>

      {/* Speaker list */}
      <div className="p-3 space-y-2">
        {displaySpeakers.map((speaker, index) => {
          const isChecked = Boolean(checkedMap[speaker.id]);
          const dotColor = DOT_COLORS[index % DOT_COLORS.length];
          const isCurrentSelected = selectedSpeakerId === speaker.id;

          return (
            <div
              key={speaker.id}
              onClick={() => {
                if (onSelectSpeaker) onSelectSpeaker(speaker.id);
              }}
              className={`group flex items-center justify-between px-3.5 py-3 rounded-xl transition-all cursor-pointer ${
                isChecked || isCurrentSelected
                  ? 'bg-[#141c33] border border-[#253663] shadow-sm'
                  : 'bg-transparent border border-transparent hover:bg-[#141c33]/50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: dotColor,
                    boxShadow: isChecked ? `0 0 10px ${dotColor}` : 'none'
                  }}
                />
                <span className={`text-sm truncate font-medium ${
                  isChecked || isCurrentSelected ? 'text-white' : 'text-[#8e9bb3]'
                }`}>
                  {speaker.name || speaker.originalLabel}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Quick Rename Button on Hover */}
                {onOpenRename && (
                  <button
                    type="button"
                    title="Đổi tên người nói"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenRename(speaker);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-white rounded transition-opacity"
                  >
                    <EditPencilIcon />
                  </button>
                )}

                {/* Custom Checkbox exactly as Figma */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCheck(speaker.id);
                  }}
                  className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                    isChecked
                      ? index === 1
                        ? 'bg-[#818cf8] text-white'
                        : 'bg-[#2563eb] text-white'
                      : 'border border-[#25334d] bg-[#101528] hover:border-[#38bdf8]'
                  }`}
                >
                  {isChecked && <CheckIcon />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-3.5 border-t border-[#1b2542] flex items-center">
        <button
          type="button"
          onClick={() => {
            if (onOpenRename && displaySpeakers[0]) {
              onOpenRename(displaySpeakers[0]);
            }
          }}
          className="text-xs font-semibold text-[#38bdf8] hover:text-[#7dd3fc] flex items-center gap-1.5 transition-colors"
        >
          <span className="text-base font-normal leading-none">+</span>
          Thêm nhãn thủ công
        </button>
      </div>
    </div>
  );
}
