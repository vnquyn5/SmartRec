import React, { useCallback, useRef } from 'react';
import MeetingVideoPlayer from './MeetingVideoPlayer';
import MeetingTabs from './MeetingTabs';
import TranscriptPanel from './TranscriptPanel';
import { seekMediaToSeconds, seekMediaWithoutPlayback } from './transcriptData';

export default function MeetingDetail({ 
  meeting,
  jobId,
  jobStatus,
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
  speakerLoading,
  results,
  resultsLoading,
  resultsError
}) {
  const mediaRef = useRef(null);
  const transcriptPanelRef = useRef(null);
  const seekToSegment = useCallback((startTime) => {
    seekMediaToSeconds(mediaRef.current, startTime);
  }, []);
  const seekToEvidence = useCallback((startTime) => {
    seekMediaWithoutPlayback(mediaRef.current, startTime);
  }, []);
  const navigateToEvidence = useCallback((transcriptId) => {
    transcriptPanelRef.current?.navigateToEvidence(transcriptId);
  }, []);

  return (
    <div className="w-full min-w-0 h-full xl:h-auto xl:flex-1 min-h-0 flex flex-col xl:flex-row gap-4 xl:gap-5 items-stretch pb-0 xl:overflow-hidden">
      {/* CỘT TRÁI: Video Player */}
      <div className="w-full min-w-0 xl:w-[48%] min-h-0 xl:h-full flex flex-col gap-4 xl:overflow-hidden">
        <MeetingVideoPlayer
          meetingId={meeting?.id}
          fileName={meeting?.fileName || meeting?.title}
          mimeType={meeting?.mimeType}
          fileType={fileType}
          mediaRef={mediaRef}
          durationSeconds={meeting?.durationSeconds}
        />
        <TranscriptPanel
          ref={transcriptPanelRef}
          meetingId={meeting?.id}
          jobId={jobId}
          jobStatus={jobStatus || aiStatus}
          mediaRef={mediaRef}
          onSeek={seekToSegment}
          onEvidenceSeek={seekToEvidence}
          results={results}
          resultsLoading={resultsLoading}
          resultsError={resultsError}
        />
      </div>

      {/* CỘT PHẢI: AI Summary, Task và Speaker */}
      <div className="w-full min-w-0 xl:w-[52%] min-h-0 xl:h-full flex flex-col">
        <MeetingTabs 
          speakers={speakers}
          mediaRef={mediaRef}
          onSeekSegment={seekToSegment}
          onEvidenceClick={navigateToEvidence}
          onSaveSpeakers={onSaveSpeakers}
          aiStatus={aiStatus}
          jobLoading={jobLoading}
          speakerError={speakerError}
          speakerLoading={speakerLoading}
          results={results}
          resultsLoading={resultsLoading}
          resultsError={resultsError}
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
