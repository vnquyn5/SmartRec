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
  
  // trả về một mảng raw và lấy mảng dữ liệu array từ mockdata
  const rawList = Array.isArray(mockSttData)
    ? mockSttData
    : (mockSttData?.mock_stt || []);
// -----------------------------------------------------//
  const transcripts = speakers.length > 0
  ? speakers 
      .flatMap ((spk) =>
      (spk.segments || []).map((seg) => ({
        speakerId: spk.id,
        speakerName:
      speakerNameMap[spk.id] || spk.name || spk.originalLabel || spk.id,
          timeStart: seg.start || "00:00",
          timeEnd: seg.end || "00:00",
          seconds: Number(seg.startSeconds) || 0,
          endSeconds: Number(seg.endSeconds) || 0,
          chunkKey:
        `${spk.id}-${seg.startSeconds}-${seg.endSeconds}`,

      }))
    )
    .sort((a, b) => a.seconds - b.seconds)
    .map((chunk, index) => ({
      ...chunk,
      id: index + 1,
      text: rawList[index % Math.max(1,
    rawList.length)]?.text || "",
      }))
        : rawList.map((item, index) => {
          const spkId = item.speaker_id || `spk_${index + 1}`;
        return {
        id: index + 1,
        speakerId: spkId,
        speakerName: speakerNameMap[spkId]
    || item.speaker_name_temp || spkId || `Speaker ${index + 1}`,
      timeStart: item.timestamp_start || "00:00:00",
      timeEnd: item.timestamp_end || "00:00:10",
      seconds: timeToSeconds(item.timestamp_start),
      chunkKey: `${spkId}-${timeToSeconds(item.timestamp_start)}-${timeToSeconds(item.timestamp_end)}`,
      text: item.text || "",
        }
    });

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('All');
  const [activeSegmentId, setActiveSegmentId] = useState(1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const listContainerRef = useRef(null);
  const itemRefs = useRef({});

  
  const speakerOptions = Array.from(
    new Map(transcripts.map((t) => [t.speakerId, { id: t.speakerId, name: t.speakerName }])).values()
  );

  
  const filteredTranscripts = transcripts.filter((item) => {
    const matchSpeaker = selectedSpeaker === 'All' || item.speakerId === selectedSpeaker;
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
  }, [selectedChunk]);

  useEffect(() => {
    const container = listContainerRef.current;
    const target = activeSegmentId ? itemRefs.current[activeSegmentId] : null;
    if (autoScroll && container && target) {
      try {
        const containerTop = container.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        const nextScrollTop = container.scrollTop + (targetTop - containerTop) - 16;
        if (typeof container.scrollTo === 'function') {
          container.scrollTo({ top: Math.max(0, nextScrollTop), behavior: 'smooth' });
        } else {
          container.scrollTop = Math.max(0, nextScrollTop);
        }
      } catch {
         
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
      .map((t) => `[${t.timeStart}] ${t.speakerName} (${t.speakerId}):\n${t.text}`)
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
    <div className="w-full flex-1 bg-[#090f1d] border border-[#1b2640] rounded-2xl flex flex-col overflow-hidden shadow-xl min-h-[420px] max-h-[520px] relative z-0 isolate">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#18233c] flex items-center justify-between bg-[#0a1122]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#38bdf8] animate-pulse"></span>
          <h3 className="text-xs font-bold text-slate-200 tracking-wider uppercase">
            Transcript Viewer (ASR Speech-to-Text)
          </h3>
        </div>

        <div className="flex items-center gap-3">
          {/* Nút bật/tắt Auto-scroll */}
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-[#38bdf8] rounded"
            />
            Auto-scroll
          </label>

          <button
            type="button"
            onClick={handleCopyAll}
            className="px-3 py-1 bg-[#141d33] hover:bg-[#1a2642] text-slate-300 hover:text-white border border-[#233357] rounded-lg text-xs font-medium transition"
          >
            {copyFeedback ? '✓ Đã sao chép' : 'Sao chép tất cả'}
          </button>
        </div>
      </div>

      {/* Thanh Tìm kiếm & BỘ LỌC SPEAKER ID DROPDOWN */}
      <div className="px-4 py-2.5 border-b border-[#141e33] bg-[#0c1324] flex flex-wrap gap-2.5 items-center">
        {/* Ô tìm kiếm */}
        <div className="relative flex-1 min-w-[180px] flex items-center">
          <svg className="absolute left-3 w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm kiếm nội dung hội thoại..."
            className="w-full bg-[#11192e] border border-[#223152] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8] transition"
          />
        </div>

        {/* BỘ LỌC DROPDOWN THEO SPEAKER ID  */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-400 whitespace-nowrap">Người nói:</span>
          <select
            value={selectedSpeaker}
            onChange={(e) => setSelectedSpeaker(e.target.value)}
            className="bg-[#11192e] border border-[#223152] rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8] transition cursor-pointer [color-scheme:dark]"
          >
            <option value="All" className="bg-[#0b1325]">Tất cả người nói (All)</option>
            {speakerOptions.map((spk) => (
              <option key={spk.id} value={spk.id} className="bg-[#0b1325]">
                {spk.name} ({spk.id})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* DANH SÁCH CÂU THOẠI THEO THỜI GIAN  */}
      <div ref={listContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
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
                className={`p-3.5 rounded-xl transition-all cursor-pointer text-xs relative ${
                  isActive
                    ? 'bg-[#132247] border border-[#38bdf8] shadow-lg shadow-cyan-950/30'
                    : 'bg-[#0d1526]/80 hover:bg-[#111c33] border border-[#1b2742]'
                }`}
              >
                {/* Header câu thoại: Speaker + Timestamp */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {/* Avatar người nói */}
                    <div className="w-6 h-6 rounded-full bg-[#1e3a6d] text-[#38bdf8] font-bold text-[10px] flex items-center justify-center border border-[#38bdf8]/30">
                      {(item.speakerName || 'S').charAt(0)}
                    </div>

                    <span className="font-bold text-slate-100 text-xs">
                      {item.speakerName}
                    </span>

                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#091122] text-slate-400 border border-[#1c2c4d]">
                      {item.speakerId}
                    </span>
                  </div>

                  {/* Timestamp Badge */}
                  <span className="font-mono text-[11px] font-bold text-[#38bdf8] bg-[#0c162b] px-2 py-0.5 rounded-md border border-[#233a68] flex items-center gap-1">
                    {isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#38bdf8] animate-ping"></span>}
                    {item.timeStart} - {item.timeEnd}
                  </span>
                </div>

                {/* Nội dung câu thoại */}
                <p className={`text-[12px] leading-relaxed pl-8 ${isActive ? 'text-white font-medium' : 'text-slate-300'}`}>
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
