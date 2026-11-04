import React, { useCallback, useRef, useState } from 'react';
import VideoPlayer from './VideoPlayer';
import MeetingTabs from './MeetingTabs';

function parseTimeToSeconds(timeVal) {
  if (typeof timeVal === 'number') return timeVal;
  if (!timeVal) return 0;
  const parts = String(timeVal).split(':').map((p) => Number(p.trim()) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(timeVal) || 0;
}

export default function MeetingDetail({ 
  meeting,
  fileType = 'video', 
  speakers = [],
  onSaveSpeakers,
  aiStatus = 'processing',
  jobLoading,
  aiError,
  onRetry,
  onPause,
  onResume,
  onCancel,
  lifecycleAction,
  onStartProcessing,
  startingProcess,
  retrying,
  speakerError,
  speakerLoading
}) {
  const mediaRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);

  const handleSeekTo = useCallback((timestamp) => {
    const media = mediaRef.current;
    const seconds = parseTimeToSeconds(timestamp);
    if (!media || !Number.isFinite(seconds) || seconds < 0 || !media.src) return;

    const performFastSeek = () => {
      if (!mediaRef.current) return;
      try {
        if (typeof mediaRef.current.fastSeek === 'function') {
          mediaRef.current.fastSeek(seconds);
        } else {
          mediaRef.current.currentTime = seconds;
        }

        const playRequest = mediaRef.current.play();
        if (playRequest && typeof playRequest.catch === 'function') {
          playRequest.catch(() => {});
        }
      } catch {
      }
    };

    if (media.readyState >= 1) {
      performFastSeek();
    } else {
      media.addEventListener('loadedmetadata', performFastSeek, { once: true });
    }
  }, []);

  return (
    <div className="w-full min-w-0 h-full flex flex-col xl:flex-row gap-5 items-stretch pb-6">
      <div className="w-full min-w-0 xl:w-[48%] flex flex-col gap-4">
        <VideoPlayer
          meetingId={meeting?.id}
          fileName={meeting?.fileName || meeting?.title}
          mimeType={meeting?.mimeType}
          fileType={fileType}
          mediaRef={mediaRef}
          onTimeUpdate={setCurrentTime}
        />
      </div>

      <div className="w-full min-w-0 xl:w-[52%] flex flex-col min-h-[500px]">
        <MeetingTabs 
          fileType={fileType} 
          speakers={speakers}
          currentTime={currentTime}
          onSeekSegment={handleSeekTo}
          onSaveSpeakers={onSaveSpeakers}
          aiStatus={aiStatus}
          jobLoading={jobLoading}
          speakerError={speakerError}
          speakerLoading={speakerLoading}
          aiError={aiError}
          onRetry={onRetry}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
          lifecycleAction={lifecycleAction}
          onStartProcessing={onStartProcessing}
          startingProcess={startingProcess}
          retrying={retrying}
        />
      </div>
    </div>
  );
}
