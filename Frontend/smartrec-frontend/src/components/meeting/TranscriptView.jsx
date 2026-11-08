import React, { useState, useRef, useEffect } from 'react';
import mockSttData from '../../mocks/mock_stt.json';

function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = String(timeStr).split(':').map((p) => Number(p.trim()) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(timeStr) || 0;
}

export default function TranscriptView({ 
  speakers = [],
  speakerNameMap = {},
  selectedChunk = null,
  onSelectChunk,
  onSeekSegment, 
}) {
  const rawList = Array.isArray(mockSttData)
    ? mockSttData
    : (mockSttData?.mock_stt || []);

  const transcripts = speakers.length > 0
    ? speakers
        .flatMap((spk) =>
          (spk.segments || []).map((seg) => ({
            speakerId: spk.id,
            speakerName:
              speakerNameMap[spk.id] || spk.name || spk.originalLabel || spk.id,
            timeStart: seg.start || "00:00",
            timeEnd: seg.end || "00:00",
            seconds: Number(seg.startSeconds) || 0,
            endSeconds: Number(seg.endSeconds) || 0,
            chunkKey: `${spk.id}-${seg.startSeconds}-${seg.endSeconds}`,
            text: seg.text || "",
          }))
        )
        .sort((a, b) => a.seconds - b.seconds)
        .map((chunk, index) => ({
          ...chunk,
          id: index + 1,
          speakerName:
            speakerNameMap[chunk.speakerId] ||
            chunk.speakerName ||
            rawList[index % Math.max(1, rawList.length)]?.speaker_name_temp ||
            chunk.speakerId,
          text:
            chunk.text ||
            rawList[index % Math.max(1, rawList.length)]?.text ||
            "",
        }))
    : rawList.map((item, index) => ({
        id: index + 1,
        speakerId: item.speaker_id || `Speaker ${(index % 3) + 1}`,
        speakerName:
          speakerNameMap[item.speaker_id] ||
          item.speaker_name_temp ||
          `Speaker ${(index % 3) + 1}`,
        timeStart: item.timestamp_start || "00:00",
        timeEnd: item.timestamp_end || "00:05",
        seconds: timeToSeconds(item.timestamp_start),
        endSeconds: timeToSeconds(item.timestamp_end),
        chunkKey: `${item.speaker_id || index}-${item.timestamp_start}-${item.timestamp_end}`,
        text: item.text || "",
      }));

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('All');
  const [activeSegmentId, setActiveSegmentId] = useState(1);
  const [autoScroll, setAutoScroll] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const listContainerRef = useRef(null);
  const itemRefs = useRef({});

  const speakerOptions = Array.from(
    new Map(transcripts.map((t) => [t.speakerId, { id: t.speakerId, name: t.speakerName }])).values()
  );

  const filteredTranscripts = transcripts.filter((item) => {
    const matchSpeaker = selectedSpeaker === 'All' || item.speakerId === selectedSpeaker || item.speakerName === selectedSpeaker;
    const sTerm = (searchTerm || '').trim().toLowerCase();
    const matchSearch =
      !sTerm ||
      (item.text || '').toLowerCase().includes(sTerm) ||
      (item.speakerName || '').toLowerCase().includes(sTerm);
    return matchSpeaker && matchSearch;
  });

  useEffect(() => {
    if (!selectedChunk?.chunkKey) return;
    const found = transcripts.find((t) => t.chunkKey === selectedChunk.chunkKey);
    if (found) setActiveSegmentId(found.id);
  }, [selectedChunk, transcripts]);

  useEffect(() => {
    const container = listContainerRef.current;
    const target = activeSegmentId ? itemRefs.current[activeSegmentId] : null;
    if (autoScroll && container && target) {
      try {
        const containerTop = container.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        const nextScrollTop = container.scrollTop + (targetTop - containerTop) - 24;
        if (typeof container.scrollTo === 'function') {
          container.scrollTo({ top: Math.max(0, nextScrollTop), behavior: 'smooth' });
        } else {
          container.scrollTop = Math.max(0, nextScrollTop);
        }
      } catch {
        // Safe fallback
      }
    }
  }, [activeSegmentId, autoScroll]);

  const handleSelectSegment = (item) => {
    setActiveSegmentId(item.id);
    onSelectChunk?.({
      chunkKey: item.chunkKey,
      speakerId: item.speakerId,
      startSeconds: item.seconds,
      endSeconds: item.endSeconds,
    });
    if (typeof onSeekSegment === 'function') {
      onSeekSegment(item.seconds);
    }
  };

  const handleCopyAll = () => {
    const fullText = filteredTranscripts
      .map((t) => `[${t.timeStart}] ${t.speakerName}:\n${t.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const renderHighlightedText = (text, keyword) => {
    if (!keyword || !keyword.trim()) return text;
    try {
      const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const parts = String(text || '').split(regex);
      return parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-amber-400/40 text-amber-200 rounded px-1">
            {part}
          </mark>
        ) : (
          part
        )
      );
    } catch {
      return text;
    }
  };

  return (
    <div className="w-full h-full min-h-[600px] flex-1 bg-[#090f1d] border border-[#1b2640] rounded-2xl flex flex-col overflow-hidden shadow-xl relative z-0 isolate">
      {/* Header matching Screenshot: TRANSCRIPT | Auto-follow Off | Copy All */}
      <div className="px-5 py-4 border-b border-[#18233c] flex items-center justify-between bg-[#0a1122]">
        <h2 className="text-sm font-bold text-white tracking-wider uppercase">
          TRANSCRIPT
        </h2>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAutoScroll((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
              autoScroll
                ? 'bg-[#18284d] border-[#38bdf8] text-[#38bdf8]'
                : 'bg-[#141d33] hover:bg-[#1a2642] text-slate-300 hover:text-white border-[#233357]'
            }`}
          >
            Auto-follow {autoScroll ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            onClick={handleCopyAll}
            className="px-3 py-1.5 bg-[#141d33] hover:bg-[#1a2642] text-slate-300 hover:text-white border border-[#233357] rounded-lg text-xs font-semibold transition"
          >
            {copyFeedback ? '✓ Copied' : 'Copy All'}
          </button>
        </div>
      </div>

      {/* Search & Speaker Filter Row */}
      <div className="px-5 py-3 border-b border-[#141e33] bg-[#0c1324] flex items-center gap-3">
        <div className="relative flex-1 flex items-center">
          <svg className="absolute left-3 w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search transcript..."
            className="w-full bg-[#11192e] border border-[#223152] rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8] transition"
          />
        </div>

        <div className="flex items-center">
          <select
            value={selectedSpeaker}
            onChange={(e) => setSelectedSpeaker(e.target.value)}
            className="bg-[#11192e] border border-[#223152] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8] transition cursor-pointer [color-scheme:dark]"
          >
            <option value="All" className="bg-[#0b1325]">All Speakers</option>
            {speakerOptions.map((spk) => (
              <option key={spk.id} value={spk.id} className="bg-[#0b1325]">
                {spk.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Transcript Bubbles */}
      <div ref={listContainerRef} className="flex-1 overflow-y-auto p-5 space-y-3">
        {filteredTranscripts.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-10">
            Không tìm thấy câu thoại phù hợp với bộ lọc.
          </p>
        ) : (
          filteredTranscripts.map((item) => {
            const isActive = activeSegmentId === item.id;
            return (
              <div
                key={item.id}
                ref={(el) => (itemRefs.current[item.id] = el)}
                onClick={() => handleSelectSegment(item)}
                data-testid="transcript-card"
                className={`p-4 rounded-xl transition-all cursor-pointer text-xs relative ${
                  isActive
                    ? 'bg-[#0f1d3b] border border-[#2563eb] shadow-lg shadow-blue-950/40'
                    : 'bg-[#0c1426] hover:bg-[#101b33] border border-[#18233c]'
                }`}
              >
                {/* Header: Timestamp + Speaker Name + [Đang chọn] badge if active */}
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="font-mono text-xs font-bold text-[#38bdf8]">
                    {item.timeStart}
                  </span>

                  <span className="font-bold text-white text-xs">
                    {item.speakerName}
                  </span>

                  {isActive && (
                    <span className="text-[10px] font-semibold text-[#34d399] bg-[#064e3b]/40 border border-[#10b981]/40 px-2 py-0.5 rounded-full ml-1">
                      Đang chọn
                    </span>
                  )}
                </div>

                {/* Content */}
                <p className={`text-xs leading-relaxed ${isActive ? 'text-white font-medium' : 'text-slate-300'}`}>
                  {renderHighlightedText(item.text, searchTerm)}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
