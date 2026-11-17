import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mockSttData from '../../mocks/mock_stt.json';
import { parseTimeToSeconds } from '../../utils/timeFormat';
import {
  loadTranscriptOverrides,
  saveTranscriptOverrides,
} from '../../services/meetingReviewService';

function EditPencilIcon({ className = 'w-3.5 h-3.5', ...props }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function RotateCcwIcon({ className = 'w-3.5 h-3.5', ...props }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedText(text, keyword) {
  const source = String(text || '');
  const trimmed = String(keyword || '').trim();
  if (!trimmed) return source;

  try {
    const escaped = escapeRegExp(trimmed);
    const splitRegex = new RegExp(`(${escaped})`, 'gi');
    const exactRegex = new RegExp(`^${escaped}$`, 'i');
    return source.split(splitRegex).map((part, index) =>
      exactRegex.test(part) ? (
        <mark key={index} className="bg-amber-400/40 text-amber-200 rounded px-1">
          {part}
        </mark>
      ) : (
        part
      )
    );
  } catch {
    return source;
  }
}

function buildTranscriptItems({ speakers, speakerNameMap, overrides }) {
  const rawList = Array.isArray(mockSttData)
    ? mockSttData
    : (mockSttData?.mock_stt || []);

  const baseItems =
    speakers.length > 0
      ? speakers
          .flatMap((spk) =>
            (spk.segments || []).map((seg) => ({
              speakerId: spk.id,
              originalLabel: spk.originalLabel || spk.id,
              speakerName:
                speakerNameMap[spk.id] || spk.name || spk.originalLabel || spk.id,
              timeStart: seg.start || '00:00',
              timeEnd: seg.end || '00:00',
              seconds: Number(seg.startSeconds) || 0,
              endSeconds: Number(seg.endSeconds) || 0,
              chunkKey: `${spk.id}-${seg.startSeconds}-${seg.endSeconds}`,
              rawText: seg.text || '',
            }))
          )
          .sort((a, b) => a.seconds - b.seconds)
          .map((chunk, index) => {
            const fallbackItem = rawList[index % Math.max(1, rawList.length)];
            const originalText = chunk.rawText || fallbackItem?.text || '';
            const speakerName =
              speakerNameMap[chunk.speakerId] ||
              chunk.speakerName ||
              fallbackItem?.speaker_name_temp ||
              chunk.speakerId;
            return {
              ...chunk,
              id: index + 1,
              speakerName,
              originalText,
            };
          })
      : rawList.map((item, index) => {
          const speakerId = item.speaker_id || `Speaker ${(index % 3) + 1}`;
          return {
            id: index + 1,
            speakerId,
            originalLabel: speakerId,
            speakerName:
              speakerNameMap[speakerId] ||
              item.speaker_name_temp ||
              speakerId,
            timeStart: item.timestamp_start || '00:00',
            timeEnd: item.timestamp_end || '00:05',
            seconds: parseTimeToSeconds(item.timestamp_start),
            endSeconds: parseTimeToSeconds(item.timestamp_end),
            chunkKey: `${item.speaker_id || index}-${item.timestamp_start}-${item.timestamp_end}`,
            originalText: item.text || '',
          };
        });

  return baseItems.map((item) => {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, item.chunkKey);
    const currentText = hasOverride ? overrides[item.chunkKey] : item.originalText;
    const isEdited = hasOverride && currentText !== item.originalText;
    return {
      ...item,
      text: currentText,
      isEdited,
    };
  });
}

function TranscriptSegmentCard({
  item,
  isActive,
  isEditing,
  searchTerm,
  cardRef,
  onSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRestoreOriginal,
  onRequestRenameSpeaker,
}) {
  const [draftText, setDraftText] = useState(item.text);
  const [editError, setEditError] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (isEditing) {
      setDraftText(item.text);
      setEditError('');
    }
  }, [isEditing, item.text]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const commitEdit = () => {
    const trimmed = draftText.trim();
    if (!trimmed) {
      setEditError('Nội dung câu thoại không được để trống.');
      return;
    }
    setEditError('');
    onSaveEdit(item, trimmed);
  };

  const handleTextareaKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setEditError('');
      setDraftText(item.text);
      onCancelEdit();
      return;
    }
    if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      event.stopPropagation();
      commitEdit();
    }
  };

  return (
    <div
      ref={cardRef}
      onClick={() => {
        if (!isEditing) onSelect(item);
      }}
      data-testid="transcript-card"
      className={`group p-4 rounded-xl transition-all text-xs relative ${
        isEditing
          ? 'bg-[#101e3c] border border-[#38bdf8] shadow-lg shadow-sky-950/40 cursor-default'
          : isActive
          ? 'bg-[#0f1d3b] border border-[#2563eb] shadow-lg shadow-blue-950/40 cursor-pointer'
          : 'bg-[#0c1426] hover:bg-[#101b33] border border-[#18233c] cursor-pointer'
      }`}
    >
      {/* Header Row: Timestamp + Speaker Name (Clickable to Rename) + Status Badges + Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-bold text-[#38bdf8] shrink-0">
            {item.timeStart}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestRenameSpeaker?.(item);
            }}
            title={`Đổi tên người nói (${item.speakerName})`}
            className="inline-flex items-center gap-1.5 font-bold text-white text-xs px-2 py-0.5 -mx-1 rounded-md hover:bg-[#19284b] hover:text-[#38bdf8] transition-colors text-left"
          >
            <span className="truncate max-w-[180px]">{item.speakerName}</span>
            <EditPencilIcon className="w-3 h-3 text-slate-400 opacity-70 group-hover:opacity-100 shrink-0" />
          </button>

          {isActive && (
            <span className="text-[10px] font-semibold text-[#34d399] bg-[#064e3b]/40 border border-[#10b981]/40 px-2 py-0.5 rounded-full">
              Đang chọn
            </span>
          )}

          {item.isEdited && (
            <span className="text-[10px] font-semibold text-amber-300 bg-amber-950/50 border border-amber-500/40 px-2 py-0.5 rounded-full">
              Đã sửa
            </span>
          )}
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {item.isEdited && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestoreOriginal(item);
                }}
                title="Khôi phục câu thoại gốc từ AI"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#2a3b62] bg-[#111b33] hover:bg-[#1a294d] text-slate-300 hover:text-amber-300 text-[11px] font-medium transition"
              >
                <RotateCcwIcon className="w-3 h-3" />
                <span>Khôi phục gốc</span>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit(item);
              }}
              title="Sửa nội dung câu thoại"
              aria-label={`Sửa câu thoại lúc ${item.timeStart}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#25365e] bg-[#121d36] hover:bg-[#1b2c52] text-slate-300 hover:text-[#38bdf8] text-[11px] font-medium transition"
            >
              <EditPencilIcon className="w-3 h-3" />
              <span>Sửa</span>
            </button>
          </div>
        )}
      </div>

      {/* Content or Inline Editor */}
      {isEditing ? (
        <div
          className="space-y-2 mt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            ref={textareaRef}
            rows={3}
            value={draftText}
            onChange={(e) => {
              setDraftText(e.target.value);
              if (editError) setEditError('');
            }}
            onKeyDown={handleTextareaKeyDown}
            aria-label={`Chỉnh sửa câu thoại lúc ${item.timeStart}`}
            placeholder="Nhập nội dung câu thoại..."
            className={`w-full rounded-lg bg-[#080e1d] border px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 resize-y leading-relaxed ${
              editError
                ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                : 'border-[#38bdf8]/70 focus:border-[#38bdf8] focus:ring-[#38bdf8]/40'
            }`}
          />

          {editError && (
            <p role="alert" className="text-[11px] text-rose-400">
              {editError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400">
              Enter để lưu · Shift+Enter xuống dòng · Esc để hủy
            </span>
            <div className="flex items-center gap-2 ml-auto">
              {item.isEdited && (
                <button
                  type="button"
                  onClick={() => onRestoreOriginal(item)}
                  className="px-2.5 py-1 rounded-lg border border-[#2a3b62] bg-[#111b33] hover:bg-[#1a294d] text-amber-300 text-[11px] font-medium transition"
                >
                  Khôi phục gốc
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditError('');
                  setDraftText(item.text);
                  onCancelEdit();
                }}
                className="px-3 py-1 rounded-lg border border-[#263558] bg-[#121a30] hover:bg-[#1a2644] text-slate-300 text-[11px] font-medium transition"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={commitEdit}
                className="px-3 py-1 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-[11px] font-semibold transition shadow-sm"
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartEdit(item);
          }}
          title="Nhấp đúp để chỉnh sửa câu thoại"
          className={`text-xs leading-relaxed ${isActive ? 'text-white font-medium' : 'text-slate-300'}`}
        >
          {renderHighlightedText(item.text, searchTerm)}
        </p>
      )}
    </div>
  );
}

export default function TranscriptEditor({
  meetingId,
  speakers = [],
  speakerNameMap = {},
  selectedChunk = null,
  currentTime = 0,
  onSelectChunk,
  onSeekSegment,
  onRequestRenameSpeaker,
  onTranscriptTextChange,
}) {
  const [overrides, setOverrides] = useState(() => loadTranscriptOverrides(meetingId));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('All');
  const [activeSegmentId, setActiveSegmentId] = useState(1);
  const [editingChunkKey, setEditingChunkKey] = useState(null);
  const [autoScroll, setAutoScroll] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const listContainerRef = useRef(null);
  const itemRefs = useRef({});

  useEffect(() => {
    setOverrides(loadTranscriptOverrides(meetingId));
    setEditingChunkKey(null);
  }, [meetingId]);

  const transcripts = useMemo(
    () => buildTranscriptItems({ speakers, speakerNameMap, overrides }),
    [speakers, speakerNameMap, overrides]
  );

  const editedCount = useMemo(
    () => transcripts.filter((item) => item.isEdited).length,
    [transcripts]
  );

  const speakerOptions = useMemo(
    () =>
      Array.from(
        new Map(
          transcripts.map((t) => [t.speakerId, { id: t.speakerId, name: t.speakerName }])
        ).values()
      ),
    [transcripts]
  );

  const filteredTranscripts = useMemo(() => {
    const sTerm = (searchTerm || '').trim().toLowerCase();
    return transcripts.filter((item) => {
      const matchSpeaker =
        selectedSpeaker === 'All' ||
        item.speakerId === selectedSpeaker ||
        item.speakerName === selectedSpeaker;
      const matchSearch =
        !sTerm ||
        (item.text || '').toLowerCase().includes(sTerm) ||
        (item.speakerName || '').toLowerCase().includes(sTerm);
      return matchSpeaker && matchSearch;
    });
  }, [transcripts, selectedSpeaker, searchTerm]);

  useEffect(() => {
    if (!selectedChunk?.chunkKey) return;
    const found = transcripts.find((t) => t.chunkKey === selectedChunk.chunkKey);
    if (found && found.id !== activeSegmentId) {
      setActiveSegmentId(found.id);
    }
  }, [selectedChunk, transcripts, activeSegmentId]);

  useEffect(() => {
    if (!autoScroll || !Number.isFinite(currentTime)) return;
    const matched = transcripts.find(
      (item) => item.seconds <= currentTime && currentTime < item.endSeconds
    );
    if (matched && matched.id !== activeSegmentId) {
      setActiveSegmentId(matched.id);
    }
  }, [autoScroll, currentTime, transcripts, activeSegmentId]);

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

  const handleSelectSegment = useCallback(
    (item) => {
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
    },
    [onSelectChunk, onSeekSegment]
  );

  const handleSaveEdit = useCallback(
    (item, nextText) => {
      setOverrides((prev) => {
        const next = { ...prev };
        if (nextText === item.originalText) {
          delete next[item.chunkKey];
        } else {
          next[item.chunkKey] = nextText;
        }
        void saveTranscriptOverrides(meetingId, next);
        onTranscriptTextChange?.(item.chunkKey, nextText, next);
        return next;
      });
      setEditingChunkKey(null);
    },
    [meetingId, onTranscriptTextChange]
  );

  const handleRestoreOriginal = useCallback(
    (item) => {
      setOverrides((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, item.chunkKey)) return prev;
        const next = { ...prev };
        delete next[item.chunkKey];
        void saveTranscriptOverrides(meetingId, next);
        onTranscriptTextChange?.(item.chunkKey, item.originalText, next);
        return next;
      });
      if (editingChunkKey === item.chunkKey) {
        setEditingChunkKey(null);
      }
    },
    [meetingId, editingChunkKey, onTranscriptTextChange]
  );

  const handleRequestRename = useCallback(
    (item) => {
      if (typeof onRequestRenameSpeaker !== 'function') return;
      const matchedSpeaker = speakers.find((s) => s.id === item.speakerId);
      const speakerUtterances = transcripts
        .filter((t) => t.speakerId === item.speakerId && t.text?.trim())
        .map((t) => t.text.trim());

      onRequestRenameSpeaker({
        id: item.speakerId,
        originalLabel: matchedSpeaker?.originalLabel || item.originalLabel || item.speakerId,
        name: item.speakerName,
        segments: matchedSpeaker?.segments || [],
        utteranceCount: matchedSpeaker?.segments?.length || speakerUtterances.length,
        sampleUtterances: speakerUtterances.slice(0, 2),
      });
    },
    [onRequestRenameSpeaker, speakers, transcripts]
  );

  const handleCopyAll = () => {
    const fullText = filteredTranscripts
      .map((t) => `[${t.timeStart}] ${t.speakerName}:\n${t.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  return (
    <div className="w-full h-full min-h-[600px] flex-1 bg-[#090f1d] border border-[#1b2640] rounded-2xl flex flex-col overflow-hidden shadow-xl relative z-0 isolate">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#18233c] flex items-center justify-between gap-2 bg-[#0a1122]">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="text-sm font-bold text-white tracking-wider uppercase">
            TRANSCRIPT
          </h2>
          {editedCount > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-950/50 text-amber-300 border border-amber-500/40 whitespace-nowrap">
              {editedCount} câu đã sửa
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
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
          <svg
            className="absolute left-3 w-3.5 h-3.5 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search transcript..."
            className="w-full bg-[#11192e] border border-[#223152] rounded-xl pl-9 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8] transition"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Xóa từ khóa tìm kiếm"
              className="absolute right-2.5 text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center">
          <select
            value={selectedSpeaker}
            onChange={(e) => setSelectedSpeaker(e.target.value)}
            aria-label="Lọc theo người nói"
            className="bg-[#11192e] border border-[#223152] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8] transition cursor-pointer [color-scheme:dark]"
          >
            <option value="All" className="bg-[#0b1325]">
              All Speakers
            </option>
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
          filteredTranscripts.map((item) => (
            <TranscriptSegmentCard
              key={item.chunkKey}
              item={item}
              isActive={activeSegmentId === item.id}
              isEditing={editingChunkKey === item.chunkKey}
              searchTerm={searchTerm}
              cardRef={(el) => {
                if (el) {
                  itemRefs.current[item.id] = el;
                } else {
                  delete itemRefs.current[item.id];
                }
              }}
              onSelect={handleSelectSegment}
              onStartEdit={(target) => setEditingChunkKey(target.chunkKey)}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={() => setEditingChunkKey(null)}
              onRestoreOriginal={handleRestoreOriginal}
              onRequestRenameSpeaker={handleRequestRename}
            />
          ))
        )}
      </div>
    </div>
  );
}

