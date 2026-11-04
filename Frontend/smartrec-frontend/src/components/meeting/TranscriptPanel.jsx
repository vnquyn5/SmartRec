import React, { useMemo, useState } from 'react';

function formatTimestamp(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TranscriptPanel({ transcripts = [], loading = false, error = '', onSeek }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSegmentId, setActiveSegmentId] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [selectedSpeaker, setSelectedSpeaker] = useState('All');
  const allSpeakers = useMemo(
    () => [...new Set(transcripts.map((item) => item.speakerLabel || 'UNKNOWN'))],
    [transcripts],
  );
  const filteredTranscripts = transcripts.filter((item) => {
    const speaker = item.speakerLabel || 'UNKNOWN';
    const text = item.textContent || '';
    return speaker.toLowerCase().includes(searchTerm.toLowerCase())
      || text.toLowerCase().includes(searchTerm.toLowerCase());
  }).filter((item) => selectedSpeaker === 'All' || (item.speakerLabel || 'UNKNOWN') === selectedSpeaker);

  const handleCopyAll = async () => {
    const fullText = transcripts
      .map((item) => `[${formatTimestamp(item.startTimeMs)}] ${item.speakerLabel || 'UNKNOWN'}:\n${item.textContent || ''}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(fullText);
      setCopyFeedback(true);
      window.setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      setCopyFeedback(false);
    }
  };

  return (
    <div className="w-full flex-1 bg-[#090f1d] border border-[#1b2640] rounded-2xl flex flex-col overflow-hidden shadow-xl min-h-[360px]">
      <div className="px-5 py-3.5 border-b border-[#18233c] flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-300 tracking-wider uppercase">TRANSCRIPT</h3>
        <button
          type="button"
          onClick={handleCopyAll}
          disabled={transcripts.length === 0}
          className="px-3 py-1 bg-[#141d33] hover:bg-[#1a2642] text-slate-300 hover:text-white border border-[#233357] rounded-lg text-xs font-medium transition disabled:opacity-40"
        >
          {copyFeedback ? '✓ Copied!' : 'Copy All'}
        </button>
      </div>

      <div className="px-4 py-2.5 border-b border-[#141e33] bg-[#0c1324] flex gap-2">
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search transcript..."
          className="min-w-0 flex-1 bg-[#11192e] border border-[#223152] rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
        />
        <select
          value={selectedSpeaker}
          onChange={(event) => setSelectedSpeaker(event.target.value)}
          className="bg-[#11192e] border border-[#223152] rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-[#38bdf8] max-w-[140px]"
        >
          <option value="All">All Speakers</option>
          {allSpeakers.map((speaker) => <option key={speaker} value={speaker}>{speaker}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <p className="text-sm text-slate-400 text-center py-8">Đang tải transcript…</p>}
        {!loading && error && <p role="alert" className="text-sm text-amber-200 text-center py-8">{error}</p>}
        {!loading && !error && transcripts.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">Chưa có transcript được lưu cho cuộc họp này.</p>
        )}
        {!loading && !error && transcripts.length > 0 && filteredTranscripts.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">Không có đoạn transcript khớp bộ lọc.</p>
        )}
        {!loading && !error && filteredTranscripts.map((item) => {
          const isSelected = activeSegmentId === item.id;
          const startSeconds = Number(item.startTimeMs) / 1000;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveSegmentId(item.id);
                if (Number.isFinite(startSeconds) && startSeconds >= 0) onSeek?.(startSeconds);
              }}
              className={`w-full text-left p-3 rounded-xl transition cursor-pointer text-xs ${isSelected
                ? 'bg-[#101b33] border border-[#2563eb] shadow-md'
                : 'hover:bg-[#0e162a] border border-transparent'}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono font-semibold text-[#38bdf8] text-[11px]">{formatTimestamp(item.startTimeMs)}</span>
                <span className="font-bold text-slate-200 text-xs">{item.speakerLabel || 'UNKNOWN'}</span>
              </div>
              <p className="text-slate-300 text-[12px] leading-relaxed pl-1">{item.textContent}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
