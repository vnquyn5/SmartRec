import React, { useEffect, useState } from 'react';
import { api } from '../../lib/http/client';

export default function MeetingVideoPlayer({ mediaUrl, fileType = 'video', mediaRef }) {
  const isAudio = fileType === 'audio';
  const [sourceUrl, setSourceUrl] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!mediaUrl) {
      setSourceUrl('');
      return undefined;
    }
    const controller = new AbortController();
    let objectUrl;
    setSourceUrl('');
    setLoadError('');
    api.get(mediaUrl, { responseType: 'blob', timeout: 0, signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSourceUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError('Không thể tải tệp cuộc họp.');
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaUrl]);

  return (
    <div className="w-full min-w-0 bg-[#080d1a] border border-[#1b2640] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
      {isAudio ? (
        <div className="aspect-video w-full bg-[#0c1324] flex flex-col items-center justify-center gap-5 p-6">
          <div className="w-20 h-20 rounded-full bg-[#172554] border border-[#2563eb]/40 flex items-center justify-center text-[#60a5fa]" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
          <audio ref={mediaRef} className="w-full max-w-lg" controls preload="metadata" src={sourceUrl || undefined}>
            Trình duyệt không hỗ trợ phát âm thanh.
          </audio>
        </div>
      ) : (
        <video ref={mediaRef} className="aspect-video w-full bg-black object-contain" controls preload="metadata" src={sourceUrl || undefined}>
          Trình duyệt không hỗ trợ phát video.
        </video>
      )}
      {loadError && <p role="alert" className="px-4 py-3 text-xs text-rose-300">{loadError}</p>}
      {!mediaUrl && <p className="px-4 py-3 text-xs text-slate-400">Không có đường dẫn tệp cuộc họp.</p>}
    </div>
  );
}
