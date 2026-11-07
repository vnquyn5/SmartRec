import React, { useCallback, useMemo, useRef, useState } from 'react';
import VideoPlayer from './VideoPlayer';
import MeetingTabs from './MeetingTabs';
import MeetingSearchBar from './MeetingSearchBar';
import PipelineJobStepper from './PipelineJobStepper';
import mockSttData from '../../mocks/mock_stt.json';
import mockSummaryData from '../../mocks/mock_summary.json';
import mockOcrData from '../../mocks/mock_ocr.json';
import { timeToSeconds } from '../../utils/timeFormat';

export default function MeetingDetail({ 
  meeting,
  job,
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
    const seconds = timeToSeconds(timestamp);
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
    <div className="w-full min-w-0 h-full flex flex-col gap-5 pb-6 font-sans">
      {/* TẦNG 1: Global Smart Search Bar */}
      <div className="w-full flex items-center justify-between gap-4">
        <MeetingSearchBar
          transcripts={searchTranscripts}
          tasks={searchTasks}
          slides={searchSlides}
          onSeek={handleSeekTo}
          className="max-w-2xl"
        />
      </div>

      {/* TẦNG 2: Bố cục 2 Cột Workspace */}
      <div className="w-full min-w-0 h-full flex flex-col xl:flex-row gap-5 items-stretch">
        {/* CỘT TRÁI (48%): Media Player & Realtime Stepper */}
        <div className="w-full min-w-0 xl:w-[48%] flex flex-col gap-4">
          <VideoPlayer
            meetingId={meeting?.id}
            fileName={meeting?.fileName || meeting?.title}
            mimeType={meeting?.mimeType}
            fileType={fileType}
            mediaRef={mediaRef}
            onTimeUpdate={setCurrentTime}
          />

          {/* Cụm Realtime Pipeline Stepper */}
          <PipelineJobStepper
            currentStage={job?.stage || (aiStatus === 'completed' ? 'OUTPUT' : 'PYANNOTE')}
            jobStatus={job?.status || (aiStatus === 'completed' ? 'COMPLETED' : aiStatus === 'failed' ? 'FAILED' : aiStatus === 'paused' ? 'PAUSED' : 'PROCESSING')}
            errorCode={job?.errorCode}
            errorMessage={aiError}
            onRetry={onRetry}
            onPause={onPause}
            onResume={onResume}
            onCancel={onCancel}
            lifecycleAction={lifecycleAction}
          />
        </div>

        {/* CỘT PHẢI (52%): Phân tích AI, Task Matrix & Transcript Tabs */}
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
    </div>
  );
}
