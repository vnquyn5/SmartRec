import React, { useState } from 'react';

export default function TranscriptPanel({ onSeek }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSegmentId, setActiveSegmentId] = useState('2');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [selectedSpeaker, setSelectedSpeaker] = useState('All');

  const transcripts = [
    {
      id: '1',
      time: '12:30',
      speaker: 'Speaker A (Alex Nguyen)',
      text: "So, looking at the current roadmap, we really need to prioritize the before the Q1 marketing push. Does that align with your team's",
    },
    {
      id: '2',
      time: '12:45',
      speaker: 'Speaker B (Sarah Chen)',
      text: "I think it makes sense. However, I'm slightly worried about the issues we saw during the last stress test. We should probably allocate two sprints for this instead",
      isActive: true,
    },
    {
      id: '3',
      time: '13:12',
      speaker: 'Speaker A (Alex Nguyen)',
      text: "Good point. Let's make sure we have the dev environment ready preliminary tests. Sarah, can you lead that sync?",
    },
    {
      id: '4',
      time: '13:40',
      speaker: 'Speaker B (Sarah Chen)',
      text: "Absolutely. I'll sync with the infrastructure team today. We also need compatibility with the new API endpoints being pushed this afternoon.",
    },
    {
      id: '5',
      time: '14:05',
      speaker: 'Speaker C (Michael Scott)',
      text: "Will there be snacks at this sync meeting? Just kidding. But really ensure the documentation is updated simultaneously.",
    },
  ];

  const handleCopyAll = () => {
    const fullText = transcripts
      .map((t) => `[${t.time}] ${t.speaker}:\n${t.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const allSpeakers = [...new Set(transcripts.map(t => t.speaker))];

  const filteredTranscripts = transcripts.filter(
    (item) => {
      const matchSearch = item.speaker.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.text.toLowerCase().includes(searchTerm.toLowerCase());
      const matchFilter = selectedSpeaker === 'All' || item.speaker === selectedSpeaker;
      return matchSearch && matchFilter;
    }
  );

  // Hàm highlight từ khóa trong văn bản
  const highlightText = (text, highlight) => {
    if (!highlight || !highlight.trim()) return text;
    
    // Tách chuỗi dựa trên từ khóa (không phân biệt hoa thường)
    const regex = new RegExp(`(${highlight})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => 
      regex.test(part) ? (
        <span key={i} className="bg-yellow-500/40 text-yellow-100 font-semibold rounded px-0.5">
          {part}
        </span>
      ) : (
        part
      )
    );
  };
  return (
    <div className="w-full flex-1 bg-[#090f1d] border border-[#1b2640] rounded-2xl flex flex-col overflow-hidden shadow-xl min-h-[360px]">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#18233c] flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-300 tracking-wider uppercase">
          TRANSCRIPT
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyAll}
            className="px-3 py-1 bg-[#141d33] hover:bg-[#1a2642] text-slate-300 hover:text-white border border-[#233357] rounded-lg text-xs font-medium transition"
          >
            {copyFeedback ? '✓ Copied!' : 'Copy All'}
          </button>
          <button
            type="button"
            className="px-3 py-1 bg-[#141d33] hover:bg-[#1a2642] text-slate-300 hover:text-white border border-[#233357] rounded-lg text-xs font-medium transition"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Search Input Bar & Filter */}
      <div className="px-4 py-2.5 border-b border-[#141e33] bg-[#0c1324] flex gap-2">
        <div className="relative flex-1 flex items-center">
          <svg
            className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search transcript..."
            className="w-full bg-[#11192e] border border-[#223152] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8] transition"
          />
        </div>
        <select
          value={selectedSpeaker}
          onChange={(e) => setSelectedSpeaker(e.target.value)}
          className="bg-[#11192e] border border-[#223152] rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-[#38bdf8] transition cursor-pointer max-w-[140px] truncate"
        >
          <option value="All">All Speakers</option>
          {allSpeakers.map(spk => (
            <option key={spk} value={spk}>{spk}</option>
          ))}
        </select>
      </div>

      {/* Transcript Items List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredTranscripts.map((item) => {
          const isSelected = activeSegmentId === item.id;
          return (
            <div
              key={item.id}
              onClick={() => {
                setActiveSegmentId(item.id);
                if (onSeek) onSeek(item.time); 
              }}
              className={`p-3 rounded-xl transition cursor-pointer text-xs ${
                isSelected
                  ? 'bg-[#101b33] border border-[#2563eb] shadow-md'
                  : 'hover:bg-[#0e162a] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono font-semibold text-[#38bdf8] text-[11px]">
                  {item.time}
                </span>
                <span className="font-bold text-slate-200 text-xs">
                  {item.speaker}
                </span>
              </div>
              <p className="text-slate-400 text-[12px] leading-relaxed pl-1">
                {item.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
