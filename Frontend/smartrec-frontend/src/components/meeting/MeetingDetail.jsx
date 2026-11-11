import React, { useCallback, useRef } from 'react';
import MeetingTabs from './MeetingTabs';
import TranscriptPanel from './TranscriptPanel';
import { seekMediaToSeconds, seekMediaWithoutPlayback } from './transcriptData';

export default function MeetingDetail({ 
  meeting,
  jobId,
  jobStatus,
  mediaRef: suppliedMediaRef,
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
  const localMediaRef = useRef(null);
  const mediaRef = suppliedMediaRef || localMediaRef;
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
    <div className="meeting-detail-columns grid w-full min-w-0 flex-1 min-h-0 grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr] xl:overflow-hidden">
      <div className="w-full min-w-0 min-h-[520px] xl:min-h-0 xl:h-full flex flex-col overflow-hidden">
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

      <div className="w-full min-w-0 min-h-[520px] xl:min-h-0 xl:h-full flex flex-col overflow-hidden">
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
