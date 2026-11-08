import React, { useCallback, useRef, useState } from 'react';
import MeetingVideoPlayer from './MeetingVideoPlayer';
import MeetingTabs from './MeetingTabs';
import TranscriptView from './TranscriptView';

export default function MeetingDetail({ 
  meeting,
  fileType = 'audio', 
  speakers = [],
  onSaveSpeakers,
  aiStatus = 'completed',
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
  speakerLoading,
  mediaRef: externalMediaRef,
  onSeek: externalOnSeek,
}) {
  const internalMediaRef = useRef(null);
  const mediaRef = externalMediaRef || internalMediaRef;

  const [selectedChunk, setSelectedChunk] = useState(null);
  const [speakerNameMap, setSpeakerNameMap] = useState({});

  const seekToSegment = useCallback((startTime) => {
    if (typeof externalOnSeek === 'function') {
      externalOnSeek(startTime);
      return;
    }

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
        // Safe fallback
      }
    };

    if (media.readyState >= 1) {
      seekAndPlay();
    } else {
      media.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    }
  }, [externalOnSeek, mediaRef]);

  return (
    <div className="w-full min-w-0 h-full flex flex-col xl:flex-row gap-5 items-stretch pb-6">
      {/* CỘT TRÁI: TRANSCRIPT Panel (chuẩn theo giao diện thiết kế) */}
      <div className="w-full min-w-0 xl:w-[46%] flex flex-col min-h-[550px]">
        {fileType === 'video' ? (
          <div className="flex flex-col gap-4 h-full">
            <MeetingVideoPlayer
              meetingId={meeting?.id}
              fileName={meeting?.fileName || meeting?.title}
              mimeType={meeting?.mimeType}
              fileType={fileType}
              mediaRef={mediaRef}
              durationSeconds={meeting?.durationSeconds}
            />
            <div className="flex-1 min-h-[350px]">
              <TranscriptView
                speakers={speakers}
                speakerNameMap={speakerNameMap}
                selectedChunk={selectedChunk}
                onSelectChunk={setSelectedChunk}
                onSeekSegment={seekToSegment}
              />
            </div>
          </div>
        ) : (
          <TranscriptView
            speakers={speakers}
            speakerNameMap={speakerNameMap}
            selectedChunk={selectedChunk}
            onSelectChunk={setSelectedChunk}
            onSeekSegment={seekToSegment}
          />
        )}
      </div>

      {/* CỘT PHẢI: Không gian phân tích AI (Tabs AI Summary, Task, Transcript & Người nói) */}
      <div className="w-full min-w-0 xl:w-[54%] flex flex-col min-h-[550px]">
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
          selectedChunk={selectedChunk}
          onSelectChunk={setSelectedChunk}
          speakerNameMap={speakerNameMap}
          onSpeakerNameMapChange={setSpeakerNameMap}
        />
      </div>
    </div>
  );
}
