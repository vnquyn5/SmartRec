import React, { useEffect, useState } from 'react';
import { api } from '../../lib/http/client';
import { formatTranscriptTime } from './transcriptData';

const ACTIVE = new Set(['PENDING', 'QUEUED', 'RUNNING', 'PROCESSING', 'RETRYING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED']);

export default function SlideOcrTab({ meetingId, jobId, jobStatus, onSeek }) {
  const [slides, setSlides] = useState([]);
  const [loading, setLoading] = useState(Boolean(meetingId));
  const [error, setError] = useState('');
  const status = String(jobStatus || '').toUpperCase();

  useEffect(() => {
    let cancelled = false;
    let timer;
    setSlides([]);
    setError('');
    setLoading(Boolean(meetingId));
    if (!meetingId) { setLoading(false); return undefined; }
    const load = async () => {
      try {
        // This route returns persisted MeetingSlide metadata (including OCR text) from Spring.
        const response = await api.get(`/meetings/${meetingId}/slides`);
        if (cancelled) return;
        if (!Array.isArray(response)) throw new Error('API OCR trả về dữ liệu không hợp lệ.');
        setSlides(response.filter((slide) => slide?.meetingId === meetingId && (!jobId || slide.jobId === jobId))
          .sort((left, right) => Number(left.timestampMs) - Number(right.timestampMs)));
        setLoading(false);
        setError('');
        if (ACTIVE.has(status)) timer = window.setTimeout(load, 2500);
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError?.message || 'Không thể tải dữ liệu OCR.');
        setLoading(false);
        if (ACTIVE.has(status)) timer = window.setTimeout(load, 2500);
      }
    };
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [meetingId, jobId, status]);

  const failure = ['FAILED', 'DLQ'].includes(status);
  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col mb-1">
        <div className="flex items-center gap-2"><span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" /><h2 className="text-sm font-bold text-white tracking-wide">Slide Keyframes &amp; OCR</h2></div>
        <p className="text-[11px] text-slate-400 mt-1 pl-3.5">Metadata OCR đã lưu cho cuộc họp</p>
      </div>
      {loading && <p role="status" className="text-sm text-slate-400 text-center py-8">Đang tải slide OCR…</p>}
      {!loading && error && <p role="alert" className="text-sm text-amber-200 text-center py-8">{error}</p>}
      {!loading && !error && failure && <p role="alert" className="text-sm text-rose-200 text-center py-8">OCR không hoàn tất vì Job xử lý thất bại.</p>}
      {!loading && !error && !failure && ACTIVE.has(status) && slides.length === 0 && <p role="status" className="text-sm text-slate-400 text-center py-8">Đang xử lý video. OCR sẽ tự cập nhật.</p>}
      {!loading && !error && !failure && !ACTIVE.has(status) && slides.length === 0 && <p className="text-sm text-slate-400 text-center py-8">NO_SLIDES_DETECTED</p>}
      {!loading && !error && slides.map((slide) => (
        <article key={slide.slideId} className="w-full bg-[#0d1526] border border-[#1b2742] rounded-2xl p-4 flex gap-4 shadow-sm">
          <button type="button" onClick={() => onSeek?.(Number(slide.timestampMs) / 1000)} aria-label={`Seek to ${formatTranscriptTime(slide.timestampMs)}`} className="relative w-28 h-20 rounded-xl bg-[#080d19] border border-[#1a253d] shrink-0 flex items-center justify-center text-slate-500 hover:text-[#38bdf8]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m10 9 5 3-5 3z" /></svg>
            <span className="absolute bottom-1 left-1.5 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-200">{formatTranscriptTime(slide.timestampMs)}</span>
          </button>
          <div className="flex-1 min-w-0">
            {slide.topic && <h3 className="text-sm font-bold text-slate-100">{slide.topic}</h3>}
            <p className="text-xs text-slate-300 mt-1 whitespace-pre-wrap">{slide.ocrText?.trim() || 'Không trích xuất được văn bản OCR cho slide này.'}</p>
            {slide.keywords?.length > 0 && <p className="text-[11px] text-slate-400 mt-2">{slide.keywords.join(' · ')}</p>}
          </div>
        </article>
      ))}
    </div>
  );
}
