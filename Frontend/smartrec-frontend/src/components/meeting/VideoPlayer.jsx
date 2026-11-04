import React, { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
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

const getMediaErrorMessage = (code) => {
  switch (code) {
    case 1:
      return 'Lỗi [1 - MEDIA_ERR_ABORTED]: Quá trình tải tệp phương tiện bị hủy bỏ.';
    case 2:
      return 'Lỗi [2 - MEDIA_ERR_NETWORK]: Lỗi kết nối mạng khi tải tệp phương tiện.';
    case 3:
      return 'Lỗi [3 - MEDIA_ERR_DECODE]: Lỗi giải mã phương tiện hoặc codec không được hỗ trợ.';
    case 4:
      return 'Lỗi [4 - MEDIA_ERR_SRC_NOT_SUPPORTED]: Định dạng phương tiện hoặc URL không được hỗ trợ.';
    default:
      return 'Lỗi [MEDIA_ERR_UNKNOWN]: Trình duyệt không thể phát tệp phương tiện này.';
  }
};

export default function VideoPlayer({
  meetingId,
  fileName,
  mimeType,
  fileType = 'video',
  mediaRef,
  onTimeUpdate,
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
        const errorMsg = 'Không thể tạo đường dẫn phát tệp cuộc họp. Vui lòng thử tải file gốc.';
        setLoadError(errorMsg);
        message.error(errorMsg);
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
      const mkvMsg = 'Trình duyệt có thể không phát trực tiếp được tệp MKV. Hãy tải file gốc để xem.';
      setLoadError(mkvMsg);
      message.warning(mkvMsg);
    }

    return () => {
      requestControllerRef.current?.abort();
      stopMedia(mediaRef?.current);
    };
  }, [meetingId, unsupportedMkv, requestPlaybackUrl, mediaRef]);

  const handleMediaError = (e) => {
    if (!meetingId) return;
    if (!refreshAttemptedRef.current) {
      refreshAttemptedRef.current = true;
      void requestPlaybackUrl(meetingId, true);
      return;
    }
    const errCode = e?.target?.error?.code || mediaRef?.current?.error?.code || 0;
    const errorMsg = getMediaErrorMessage(errCode);
    setLoadError(errorMsg);
    message.error(errorMsg);
  };

  const handleDownload = async () => {
    if (!meetingId || downloading) return;
    setDownloading(true);
    setLoadError('');
    try {
      const blob = await downloadMeeting(meetingId);
      triggerBlobDownload(blob, fileName || 'meeting-file');
    } catch {
      const downloadErrMsg = 'Không thể tải file cuộc họp. Vui lòng thử lại.';
      setLoadError(downloadErrMsg);
      message.error(downloadErrMsg);
    } finally {
      setDownloading(false);
    }
  };

  const handleTimeUpdate = (e) => {
    if (typeof onTimeUpdate === 'function') {
      onTimeUpdate(e.target.currentTime);
    }
  };

  return (
    <div className="video-player-container w-full min-w-0 bg-[#080d1a] border border-[#1b2640] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
      {loading && (
        <div id="video-player-loading" className="video-player-loading aspect-video w-full bg-[#0c1324] flex items-center justify-center">
          <p className="video-player-loading-text text-xs text-slate-400 animate-pulse">Đang nạp luồng phát đa phương tiện…</p>
        </div>
      )}

      {unsupportedMkv ? (
        <div className="video-player-unsupported aspect-video w-full bg-[#0c1324] flex flex-col items-center justify-center gap-4 p-6 text-center">
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
        <div className="audio-player-wrapper aspect-video w-full bg-[#0c1324] flex flex-col items-center justify-center gap-5 p-6">
          <div className="w-20 h-20 rounded-full bg-[#172554] border border-[#2563eb]/40 flex items-center justify-center text-[#60a5fa]" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
          </div>
          <audio
            ref={mediaRef}
            className="w-full max-w-lg"
            controls
            preload="auto"
            src={playbackUrl || undefined}
            onTimeUpdate={handleTimeUpdate}
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
          preload="auto"
          src={playbackUrl || undefined}
          onTimeUpdate={handleTimeUpdate}
          onError={handleMediaError}
        >
          Trình duyệt không hỗ trợ phát video.
        </video>
      )}

      {loadError && (
        <div className="video-player-error p-3 bg-rose-950/40 border-t border-rose-500/20 text-rose-300 text-xs text-center">
          {loadError}
        </div>
      )}
    </div>
  );
}
