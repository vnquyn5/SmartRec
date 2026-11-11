import React, { useCallback, useEffect, useRef, useState } from 'react';
import { downloadMeeting, getMeetingPlaybackUrl } from '../../services/meetingService';
import { seekMediaWithoutPlayback } from './transcriptData';

const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];

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
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
};

function formatMediaTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export default function MeetingVideoPlayer({
  meetingId,
  fileName,
  mimeType,
  fileType = 'video',
  mediaRef,
  durationSeconds,
}) {
  const isAudio = fileType === 'audio';
  const unsupportedMkv = isMkvMedia(fileName, mimeType);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
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
    setCurrentTime(0);
    setMediaDuration(0);
    setIsPlaying(false);
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
  }, [meetingId, fileType, unsupportedMkv, requestPlaybackUrl, mediaRef]);

  useEffect(() => {
    const media = mediaRef?.current;
    if (!media) return undefined;
    const syncMediaState = () => {
      setCurrentTime(Number.isFinite(media.currentTime) ? media.currentTime : 0);
      setMediaDuration(Number.isFinite(media.duration) ? media.duration : 0);
      setIsPlaying(!media.paused && !media.ended);
      setVolume(Number.isFinite(media.volume) ? media.volume : 1);
      setIsMuted(media.muted);
      setPlaybackRate(media.playbackRate || 1);
    };
    const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'playing', 'pause', 'ended', 'volumechange', 'ratechange'];
    events.forEach((eventName) => media.addEventListener(eventName, syncMediaState));
    syncMediaState();
    return () => events.forEach((eventName) => media.removeEventListener(eventName, syncMediaState));
  }, [mediaRef, fileType, unsupportedMkv]);

  const handleMediaError = () => {
    if (!meetingId) return;
    if (!refreshAttemptedRef.current) {
      refreshAttemptedRef.current = true;
      void requestPlaybackUrl(meetingId, true);
      return;
    }
    setLoadError('Trình duyệt không thể phát tệp hoặc codec này. Bạn có thể tải file gốc để xem.');
  };

  const handlePlayPause = async () => {
    const media = mediaRef?.current;
    if (!media || !playbackUrl || unsupportedMkv) return;
    if (media.paused) {
      try {
        await media.play();
      } catch {
        setLoadError('Không thể phát media. Hãy thử lại hoặc tải file gốc.');
      }
    } else {
      media.pause();
    }
  };

  const handleSeek = (event) => {
    const target = Number(event.target.value);
    if (Number.isFinite(target)) seekMediaWithoutPlayback(mediaRef?.current, target);
  };

  const handleRewind = () => {
    const media = mediaRef?.current;
    if (!media) return;
    seekMediaWithoutPlayback(media, Math.max(0, (media.currentTime || 0) - 10));
  };

  const handleRateChange = () => {
    const media = mediaRef?.current;
    if (!media) return;
    const currentIndex = PLAYBACK_RATES.indexOf(media.playbackRate);
    const nextRate = PLAYBACK_RATES[(currentIndex + 1 + PLAYBACK_RATES.length) % PLAYBACK_RATES.length];
    media.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  const handleVolumeChange = (event) => {
    const media = mediaRef?.current;
    if (!media) return;
    const nextVolume = Number(event.target.value);
    media.volume = nextVolume;
    media.muted = nextVolume === 0;
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
  };

  const toggleMute = () => {
    const media = mediaRef?.current;
    if (!media) return;
    media.muted = !media.muted;
    setIsMuted(media.muted);
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

  const displayDuration = mediaDuration > 0
    ? mediaDuration
    : Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
      ? Number(durationSeconds)
      : 0;
  const canControl = Boolean(meetingId && playbackUrl && !unsupportedMkv);

  return (
    <div className="meeting-media-player min-w-0 w-full max-w-[680px] rounded-xl border border-[#233357] bg-[#10182b] px-2.5 py-2 shadow-lg sm:px-3">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {unsupportedMkv ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-xs text-slate-300">Không thể phát trực tiếp tệp MKV.</span>
          </div>
        ) : (
          <>
            {isAudio ? (
              <audio
                ref={mediaRef}
                preload="metadata"
                src={playbackUrl || undefined}
                onError={handleMediaError}
                className="sr-only"
              >
                Trình duyệt không hỗ trợ phát âm thanh.
              </audio>
            ) : (
              <video
                ref={mediaRef}
                preload="metadata"
                src={playbackUrl || undefined}
                onError={handleMediaError}
                className="h-10 w-16 shrink-0 rounded-md bg-black object-cover sm:h-12 sm:w-[86px]"
                aria-label="Video cuộc họp"
              >
                Trình duyệt không hỗ trợ phát video.
              </video>
            )}
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={!canControl}
              aria-label={isPlaying ? 'Tạm dừng media' : 'Phát media'}
              title={isPlaying ? 'Tạm dừng' : 'Phát'}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-950 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.8c0-.8.9-1.3 1.6-.9l11 6.2a1 1 0 010 1.8l-11 6.2a1 1 0 01-1.6-.9V4.8z" /></svg>
              )}
            </button>
            <span className="w-[74px] shrink-0 text-center font-mono text-[10px] text-slate-300 sm:w-[90px] sm:text-[11px]">
              {formatMediaTime(currentTime)} / {displayDuration ? formatMediaTime(displayDuration) : '--:--'}
            </span>
            <input
              aria-label="Media progress"
              type="range"
              min="0"
              max={displayDuration || 1}
              step="0.1"
              value={Math.min(currentTime, displayDuration || 1)}
              onChange={handleSeek}
              disabled={!canControl || displayDuration <= 0}
              className="meeting-player-range min-w-[45px] flex-1 accent-sky-400 disabled:opacity-40"
            />
            <button
              type="button"
              onClick={handleRateChange}
              disabled={!canControl}
              className="shrink-0 rounded px-1.5 py-1 text-[10px] font-bold text-slate-200 hover:bg-[#1c2943] disabled:opacity-40 sm:text-[11px]"
              aria-label={`Tốc độ phát ${playbackRate}x; nhấn để thay đổi`}
              title="Tốc độ phát"
            >
              {playbackRate}x
            </button>
            <button
              type="button"
              onClick={handleRewind}
              disabled={!canControl}
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-[#1c2943] hover:text-white disabled:opacity-40 sm:flex"
              aria-label="Tua lại 10 giây"
              title="Tua lại 10 giây"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4l2.5 1.5" /></svg>
            </button>
            <button
              type="button"
              onClick={toggleMute}
              disabled={!canControl}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-[#1c2943] hover:text-white disabled:opacity-40"
              aria-label={isMuted ? 'Bật âm lượng' : 'Tắt âm lượng'}
              title={isMuted ? 'Bật âm lượng' : 'Tắt âm lượng'}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                {isMuted || volume === 0 ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18 5.5a9 9 0 0 1 0 13" /></>}
              </svg>
            </button>
            <input
              aria-label="Volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              disabled={!canControl}
              className="meeting-player-range hidden w-[54px] shrink-0 accent-slate-300 disabled:opacity-40 lg:block"
            />
          </>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={!meetingId || downloading}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-[#1c2943] hover:text-white disabled:cursor-wait disabled:opacity-40"
          aria-label={downloading ? 'Đang tải file' : 'Tải file cuộc họp'}
          title={downloading ? 'Đang tải…' : 'Tải file'}
        >
          {downloading ? <span className="text-[10px]">…</span> : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></svg>}
        </button>
      </div>
      {(loading || loadError || unsupportedMkv) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {loading && <p role="status" className="min-w-0 truncate text-[10px] text-slate-400">Đang chuẩn bị phát media…</p>}
          {loadError && <p role="alert" className="min-w-0 truncate text-[10px] text-amber-200" title={loadError}>{loadError}</p>}
          {unsupportedMkv && <p className="min-w-0 truncate text-[10px] text-slate-400">Trình duyệt không hỗ trợ phát trực tiếp định dạng này.</p>}
        </div>
      )}
    </div>
  );
}
