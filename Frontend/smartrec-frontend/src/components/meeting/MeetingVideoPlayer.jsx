import React, { useCallback, useEffect, useRef, useState } from 'react';
import { downloadMeeting, getMeetingPlaybackUrl } from '../../services/meetingService';

const isMkvMedia = (fileName, mimeType) =>
  mimeType?.toLowerCase() === 'video/x-matroska' || /\.mkv$/i.test(fileName || '');

const stopMedia = (media) => {
  if (!media) return;
  media.pause();
  media.removeAttribute('src');
  media.load();
};

const triggerBlobDownload = (blob, fileName) => {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName || 'meeting-file';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
};

export default function MeetingVideoPlayer({
  meetingId,
  fileName,
  mimeType,
  fileType = 'video',
  mediaRef,
}) {
  const isAudio = fileType === 'audio';
  const unsupportedMkv = isMkvMedia(fileName, mimeType);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const refreshAttemptedRef = useRef(false);
  const requestControllerRef = useRef(null);

  const requestPlaybackUrl = useCallback(async (id, isRefresh = false) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    if (isRefresh) setPlaybackUrl('');
    setLoading(!isRefresh);
    setLoadError('');
    try {
      const response = await getMeetingPlaybackUrl(id, controller.signal);
      if (!controller.signal.aborted) {
        const url = typeof response?.url === 'string' ? response.url : '';
        if (!url) throw new Error('Playback URL is missing');
        setPlaybackUrl(url);
      }
    } catch {
      if (!controller.signal.aborted) {
        setPlaybackUrl('');
        setLoadError('Không thể tạo đường dẫn phát tệp cuộc họp. Vui lòng thử tải file gốc.');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    stopMedia(mediaRef?.current);
    setPlaybackUrl('');
    setLoadError('');
    setLoading(false);
    refreshAttemptedRef.current = false;
    requestControllerRef.current?.abort();

    if (meetingId && !unsupportedMkv) {
      void requestPlaybackUrl(meetingId);
    } else if (unsupportedMkv) {
      setLoadError('Trình duyệt có thể không phát trực tiếp được tệp MKV. Hãy tải file gốc để xem.');
    }

    return () => {
      requestControllerRef.current?.abort();
      stopMedia(mediaRef?.current);
    };
  }, [meetingId, unsupportedMkv, requestPlaybackUrl, mediaRef]);

  const handleMediaError = () => {
    if (!meetingId) return;
    if (!refreshAttemptedRef.current) {
      refreshAttemptedRef.current = true;
      void requestPlaybackUrl(meetingId, true);
      return;
    }
    setLoadError('Trình duyệt không thể phát tệp hoặc codec này. Bạn có thể tải file gốc để xem.');
  };

  const handleDownload = async () => {
    if (!meetingId || downloading) return;
    setDownloading(true);
    setLoadError('');
    try {
      const blob = await downloadMeeting(meetingId);
      triggerBlobDownload(blob, fileName || 'meeting-file');
    } catch {
      setLoadError('Không thể tải file cuộc họp. Vui lòng thử lại.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="w-full min-w-0 bg-[#080d1a] border border-[#1b2640] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
      {unsupportedMkv ? (
        <div className="aspect-video w-full bg-[#0c1324] flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-slate-300">Trình duyệt không hỗ trợ phát trực tiếp định dạng MKV.</p>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
          >
            {downloading ? 'Đang tải…' : 'Tải file gốc'}
          </button>
        </div>
      ) : isAudio ? (
        <div className="aspect-video w-full bg-[#0c1324] flex flex-col items-center justify-center gap-5 p-6">
          <div className="w-20 h-20 rounded-full bg-[#172554] border border-[#2563eb]/40 flex items-center justify-center text-[#60a5fa]" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
          <audio
            ref={mediaRef}
            className="w-full max-w-lg"
            controls
            preload="metadata"
            src={playbackUrl || undefined}
            onError={handleMediaError}
          >
            Trình duyệt không hỗ trợ phát âm thanh.
          </audio>
        </div>
      ) : (
        <video
          ref={mediaRef}
          className="aspect-video w-full bg-black object-contain"
          controls
          preload="metadata"
          src={playbackUrl || undefined}
          onError={handleMediaError}
        >
          Trình duyệt không hỗ trợ phát video.
        </video>
      )}
      {loading && <p className="px-4 py-3 text-xs text-slate-400">Đang chuẩn bị phát media…</p>}
      {loadError && (
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <p role="alert" className="text-xs text-amber-200">{loadError}</p>
          {!unsupportedMkv && meetingId && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="shrink-0 rounded-lg border border-[#334467] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#17233c] disabled:cursor-wait disabled:opacity-60"
            >
              {downloading ? 'Đang tải…' : 'Tải file gốc'}
            </button>
          )}
        </div>
      )}
      {!meetingId && <p className="px-4 py-3 text-xs text-slate-400">Không có cuộc họp để phát.</p>}
    </div>
  );
}
