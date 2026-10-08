import React, { useCallback, useRef } from 'react';
import MeetingVideoPlayer from './MeetingVideoPlayer';
import MeetingTabs from './MeetingTabs';

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
  const seekToSegment = useCallback((startTime) => {
    const media = mediaRef.current;
    const seconds = Number(startTime);
    if (!media || !Number.isFinite(seconds) || seconds < 0 || !media.src) return;

    const seekAndPlay = () => {
      if (!mediaRef.current) return;
      try {
        mediaRef.current.currentTime = seconds;
        const playRequest = mediaRef.current.play();
        if (playRequest && typeof playRequest.catch === 'function') {
          playRequest.catch(() => {});
        }
      } catch {
        // The media can become unavailable while a timestamp is being selected.
      }
    };

    if (media.readyState >= 1) {
      seekAndPlay();
    } else {
      media.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    }
  }, []);

  return (
    <div className="w-full min-w-0 h-full flex flex-col xl:flex-row gap-5 items-stretch pb-6">
      {/* CỘT TRÁI: Video Player */}
      <div className="w-full min-w-0 xl:w-[48%] flex flex-col gap-4">
        <MeetingVideoPlayer
          meetingId={meeting?.id}
          fileName={meeting?.fileName || meeting?.title}
          mimeType={meeting?.mimeType}
          fileType={fileType}
          mediaRef={mediaRef}
          durationSeconds={meeting?.durationSeconds}
        />
      </div>

      {/* CỘT PHẢI: Hệ thống Tabs (AI Summary, Task, Speaker, Slide Keyframes) */}
      <div className="w-full min-w-0 xl:w-[52%] flex flex-col min-h-[500px]">
        <MeetingTabs 
          fileType={fileType} 
          speakers={speakers}
          onSeekSegment={seekToSegment}
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
