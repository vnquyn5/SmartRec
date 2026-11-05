import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/http/client';
import {
  filterTranscriptSegments,
  formatTranscriptTime,
  findActiveTranscriptSegment,
  isTranscriptScrollKey,
  mapTranscriptResults,
  scrollTranscriptRowNearTop,
  shouldAutoScrollTranscriptSegment,
  subscribeTranscriptMedia,
} from './transcriptData';

const ACTIVE = new Set(['PENDING', 'QUEUED', 'RUNNING', 'PROCESSING', 'RETRYING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED']);

export default function TranscriptPanel({ meetingId, jobId, jobStatus, mediaRef, onSeek }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('All');
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [error, setError] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [activeSegmentId, setActiveSegmentId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollContainerRef = useRef(null);
  const segmentNodesRef = useRef(new Map());
  const lastAutoScrolledSegmentIdRef = useRef(null);
  const status = String(jobStatus || '').toUpperCase();
  const [resultStatus, setResultStatus] = useState(status);
  const effectiveStatus = String(resultStatus || status).toUpperCase();

  useEffect(() => {
    let cancelled = false;
    let timer;
    setSegments([]);
    setActiveSegmentId(null);
    setError('');
    setResultStatus(status);
    setLoading(Boolean(jobId));
    if (!meetingId || !jobId) {
      setLoading(false);
      return undefined;
    }

    const load = async () => {
      try {
        const response = await api.get(`/meetings/${meetingId}/jobs/${jobId}/results`);
        if (cancelled) return;
        if (response?.meetingId !== meetingId || response?.jobId !== jobId) {
          throw new Error('API trả kết quả không thuộc cuộc họp hoặc Job hiện tại.');
        }
        setSegments(mapTranscriptResults(response));
        setResultStatus(String(response.jobStatus || status).toUpperCase());
        setError('');
        setLoading(false);
        const responseStatus = String(response.jobStatus || status).toUpperCase();
        if (ACTIVE.has(responseStatus)) timer = window.setTimeout(load, 2500);
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError?.message || 'Không thể tải transcript.');
        setLoading(false);
        if (ACTIVE.has(status)) timer = window.setTimeout(load, 2500);
      }
    };
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [meetingId, jobId, status]);

  const updateActiveSegment = useCallback((nextId) => {
    setActiveSegmentId((currentId) => currentId === nextId ? currentId : nextId);
  }, []);
  const updatePlaying = useCallback((nextPlaying) => {
    setIsPlaying((current) => current === nextPlaying ? current : nextPlaying);
  }, []);

  useEffect(() => {
    if (!segments.length || !mediaRef?.current) {
      setActiveSegmentId(null);
      setIsPlaying(false);
      return undefined;
    }
    return subscribeTranscriptMedia(mediaRef.current, segments, updateActiveSegment, updatePlaying);
  }, [mediaRef, segments, updateActiveSegment, updatePlaying]);

  const speakers = useMemo(() => [...new Set(segments.map((segment) => segment.speaker))], [segments]);
  const filtered = useMemo(
    () => filterTranscriptSegments(segments, searchTerm, selectedSpeaker),
    [segments, searchTerm, selectedSpeaker],
  );

  const scrollActiveSegmentIntoView = useCallback((segmentId = activeSegmentId) => {
    const container = scrollContainerRef.current;
    if (segmentId == null) return;
    const row = segmentNodesRef.current.get(segmentId);
    if (!container || !row) {
      lastAutoScrolledSegmentIdRef.current = null;
      return;
    }
    if (!shouldAutoScrollTranscriptSegment(lastAutoScrolledSegmentIdRef, segmentId)) return;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    scrollTranscriptRowNearTop(container, row, prefersReducedMotion ? 'auto' : 'smooth');
  }, [activeSegmentId]);

  useEffect(() => {
    if (autoFollow && activeSegmentId != null) scrollActiveSegmentIntoView();
  }, [activeSegmentId, autoFollow, filtered, scrollActiveSegmentIntoView]);

  const suspendAutoFollow = () => {
    lastAutoScrolledSegmentIdRef.current = null;
    setAutoFollow(false);
  };

  const handleAutoFollowToggle = () => {
    const resume = !autoFollow;
    setAutoFollow(resume);
    if (!resume) return;
    lastAutoScrolledSegmentIdRef.current = null;
    const media = mediaRef?.current;
    const currentId = media
      ? findActiveTranscriptSegment(segments, media.currentTime)
      : activeSegmentId;
    if (currentId != null) {
      updateActiveSegment(currentId);
      scrollActiveSegmentIntoView(currentId);
    }
  };

  const handleSegmentClick = (segment) => {
    lastAutoScrolledSegmentIdRef.current = null;
    setAutoFollow(true);
    updateActiveSegment(segment.id);
    scrollActiveSegmentIntoView(segment.id);
    onSeek?.(segment.startTimeMs / 1000);
  };

  const handleCopyAll = async () => {
    const fullText = segments
      .map((segment) => `[${formatTranscriptTime(segment.startTimeMs)}] ${segment.speaker}:\n${segment.text}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(fullText);
      setCopyFeedback('Copied');
    } catch {
      setCopyFeedback('Copy unavailable');
    }
    window.setTimeout(() => setCopyFeedback(''), 2000);
  };

  return (
    <section aria-label="Transcript" className="w-full min-h-[240px] xl:min-h-0 xl:flex-1 xl:h-auto bg-[#090f1d] border border-[#1b2640] rounded-2xl flex flex-col overflow-hidden shadow-xl">
      <div className="px-5 py-3.5 border-b border-[#18233c] flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold text-slate-300 tracking-wider uppercase">TRANSCRIPT</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAutoFollowToggle}
            aria-pressed={autoFollow}
            className="px-2.5 py-1 bg-[#141d33] text-slate-300 border border-[#233357] rounded-lg text-[11px] font-medium hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
          >
            Auto-follow {autoFollow ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            onClick={handleCopyAll}
            disabled={!segments.length}
            className="px-3 py-1 bg-[#141d33] text-slate-300 border border-[#233357] rounded-lg text-xs font-medium disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
          >
            {copyFeedback || 'Copy All'}
          </button>
        </div>
      </div>
      <div className="px-4 py-2.5 border-b border-[#141e33] bg-[#0c1324] flex gap-2">
        <input
          aria-label="Search transcript"
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search transcript..."
          className="flex-1 bg-[#11192e] border border-[#223152] rounded-xl px-3 py-1.5 text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
        />
        <select
          aria-label="Filter speaker"
          value={selectedSpeaker}
          onChange={(event) => setSelectedSpeaker(event.target.value)}
          className="bg-[#11192e] border border-[#223152] rounded-xl px-2.5 py-1.5 text-xs text-slate-300 max-w-[160px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
        >
          <option value="All">All Speakers</option>
          {speakers.map((speaker) => <option key={speaker} value={speaker}>{speaker}</option>)}
        </select>
      </div>
      <div
        ref={scrollContainerRef}
        onWheel={suspendAutoFollow}
        onTouchStart={suspendAutoFollow}
        onPointerDown={suspendAutoFollow}
        onMouseDown={suspendAutoFollow}
        onKeyDown={(event) => { if (isTranscriptScrollKey(event)) suspendAutoFollow(); }}
        role="region"
        aria-label="Transcript segments"
        tabIndex={0}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 overscroll-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#38bdf8]"
      >
        {loading && <p role="status" className="text-sm text-slate-400 text-center py-8">Đang tải transcript…</p>}
        {!loading && error && <p role="alert" className="text-sm text-amber-200 text-center py-8">{error}</p>}
        {!loading && !error && !jobId && <p className="text-sm text-slate-400 text-center py-8">Cuộc họp chưa có Job xử lý.</p>}
        {!loading && !error && jobId && ACTIVE.has(effectiveStatus) && segments.length === 0 && <p role="status" className="text-sm text-slate-400 text-center py-8">Đang xử lý. Transcript sẽ tự cập nhật khi có kết quả.</p>}
        {!loading && !error && jobId && !ACTIVE.has(effectiveStatus) && segments.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Job đã hoàn tất nhưng không có transcript.</p>}
        {!loading && !error && filtered.length === 0 && segments.length > 0 && <p className="text-sm text-slate-400 text-center py-8">Không có câu thoại khớp bộ lọc.</p>}
        {filtered.map((segment) => {
          const isActive = activeSegmentId === segment.id;
          const timestamp = formatTranscriptTime(segment.startTimeMs);
          return (
            <button
              key={segment.id}
              ref={(node) => {
                if (node) segmentNodesRef.current.set(segment.id, node);
                else segmentNodesRef.current.delete(segment.id);
              }}
              type="button"
              onClick={() => handleSegmentClick(segment)}
              aria-current={isActive ? 'true' : undefined}
              aria-label={`Seek to ${timestamp}. ${segment.speaker}: ${segment.text}`}
              className={`w-full text-left p-3 rounded-xl border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                isActive
                  ? 'bg-[#101b33] border-[#2563eb] shadow-md'
                  : 'hover:bg-[#0e162a] border-transparent'
              }`}
            >
              <span className="flex items-center gap-2 mb-1.5">
                <span className="font-mono font-semibold text-[#38bdf8] text-[11px]">{timestamp}</span>
                <span className="font-bold text-slate-200 text-xs">{segment.speaker}</span>
                {segment.attributionStatus === 'CROSS_SPEAKER_BOUNDARY' && (
                  <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200"
                    title="Đoạn transcript đi qua ranh giới speaker; chưa thể gán một người nói duy nhất.">
                    CROSS_SPEAKER_BOUNDARY
                  </span>
                )}
                {segment.attributionStatus === 'UNRESOLVED' && (
                  <span className="rounded border border-slate-500/40 px-1.5 py-0.5 text-[9px] text-slate-300">
                    Attribution unavailable
                  </span>
                )}
                {isActive && isPlaying && <span className="text-[10px] font-semibold text-sky-300">▶ Đang phát</span>}
                {isActive && !isPlaying && <span className="text-[10px] font-semibold text-sky-300">Đang chọn</span>}
              </span>
              <span className="block text-slate-300 text-[12px] leading-relaxed pl-1">{segment.text}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
