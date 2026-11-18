import React, { useCallback, useMemo, useRef } from 'react';
import MeetingTabs from './MeetingTabs';
import TranscriptPanel from './TranscriptPanel';
import MeetingSearchBar from './MeetingSearchBar';
import RealtimeStepper from './RealtimeStepper';
import mockSttData from '../../mocks/mock_stt.json';
import mockSummaryData from '../../mocks/mock_summary.json';
import mockOcrData from '../../mocks/mock_ocr.json';
import { seekMediaToSeconds, seekMediaWithoutPlayback } from './transcriptData';
import { timeToSeconds } from '../../utils/timeFormat';

export default function MeetingDetail({
  meeting,
  job,
  jobId,
  jobStatus,
  fileType = 'video',
  mediaRef: suppliedMediaRef,
  speakers = [],
  currentTime = 0,
  onSaveSpeakers,
  onTimeUpdate,
  onEnded,
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
  results,
  resultsLoading,
  resultsError
}) {
  const localMediaRef = useRef(null);
  const mediaRef = suppliedMediaRef || localMediaRef;
  const transcriptPanelRef = useRef(null);
  const seekToSegment = useCallback((startTime) => {
    const seconds = typeof startTime === 'string' && startTime.includes(':')
      ? timeToSeconds(startTime)
      : Number(startTime);
    seekMediaToSeconds(mediaRef.current, seconds);
  }, [mediaRef]);
  const seekToEvidence = useCallback((startTime) => {
    seekMediaWithoutPlayback(mediaRef.current, startTime);
  }, [mediaRef]);
  const navigateToEvidence = useCallback((transcriptId) => {
    transcriptPanelRef.current?.navigateToEvidence(transcriptId);
  }, []);

  // Chuẩn bị danh sách transcripts cho Search Bar
  const searchTranscripts = useMemo(() => {
    const rawStt = Array.isArray(mockSttData) ? mockSttData : (mockSttData?.mock_stt || []);
    if (speakers && speakers.length > 0) {
      return speakers.flatMap((spk) =>
        (spk.segments || []).map((seg) => ({
          id: `${spk.id}-${seg.startSeconds || seg.start}`,
          text: seg.text || rawStt[0]?.text || "",
          speakerName: spk.name || spk.originalLabel || spk.id,
          timeStart: seg.start || "00:00",
          seconds: Number(seg.startSeconds) || timeToSeconds(seg.start),
        }))
      );
    }
    return rawStt.map((item, idx) => ({
      id: `mock-stt-${idx}`,
      text: item.text || "",
      speakerName: item.speaker_name_temp || item.speaker_id || "Speaker",
      timeStart: item.timestamp_start || "00:00",
      seconds: timeToSeconds(item.timestamp_start),
    }));
  }, [speakers]);

  // Chuẩn bị danh sách tasks cho Search Bar
  const searchTasks = useMemo(() => {
    return mockSummaryData?.task || [];
  }, []);

  // Chuẩn bị danh sách slides cho Search Bar
  const searchSlides = useMemo(() => {
    return Array.isArray(mockOcrData) ? mockOcrData : (mockOcrData?.mock_ocr || []);
  }, []);

  return (
    <div className="w-full min-w-0 flex-1 min-h-0 flex flex-col gap-3">
      <div className="w-full flex items-center justify-between gap-4 shrink-0">
        <MeetingSearchBar
          transcripts={searchTranscripts}
          tasks={searchTasks}
          slides={searchSlides}
          onSeek={seekToSegment}
          className="max-w-2xl"
        />
      </div>

      <div className="meeting-detail-columns grid w-full min-w-0 flex-1 min-h-0 grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr] xl:overflow-hidden">
        <div className="w-full min-w-0 min-h-[520px] xl:min-h-0 xl:h-full flex flex-col gap-3 overflow-hidden">
          {job?.id && !['completed', 'empty'].includes(aiStatus) && (
            <RealtimeStepper
              jobId={job.id}
              meetingId={meeting?.id}
              initialJob={job}
              currentStage={job?.stage || 'PYANNOTE'}
              jobStatus={job?.status || jobStatus || 'PROCESSING'}
              errorCode={job?.errorCode}
              errorMessage={aiError}
              onRetry={onRetry}
              onPause={onPause}
              onResume={onResume}
              onCancel={onCancel}
              lifecycleAction={lifecycleAction}
            />
          )}
          <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
            <TranscriptPanel
              ref={transcriptPanelRef}
              meetingId={meeting?.id}
              jobId={jobId || job?.id}
              jobStatus={jobStatus || job?.status || aiStatus}
              mediaRef={mediaRef}
              onSeek={seekToSegment}
              onEvidenceSeek={seekToEvidence}
              results={results}
              resultsLoading={resultsLoading}
              resultsError={resultsError}
            />
          </div>
        </div>

        <div className="w-full min-w-0 min-h-[520px] xl:min-h-0 xl:h-full flex flex-col overflow-hidden">
          <MeetingTabs
            fileType={fileType}
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
    </div>
  );
}
