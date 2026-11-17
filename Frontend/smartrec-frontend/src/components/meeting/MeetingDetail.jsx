import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MeetingVideoPlayer from './MeetingVideoPlayer';
import MeetingTabs from './MeetingTabs';
import TranscriptEditor from './TranscriptEditor';
import RenameSpeakerModal from './RenameSpeakerModal';
import {
  loadSpeakerNameOverrides,
  saveSpeakerNameOverrides,
} from '../../services/meetingReviewService';

function buildInitialSpeakerNameMap(speakers = [], meetingId) {
  const overrides = loadSpeakerNameOverrides(meetingId);
  const map = {};
  speakers.forEach((speaker) => {
    map[speaker.id] =
      overrides[speaker.id] || speaker.name || speaker.originalLabel || speaker.id;
  });
  Object.entries(overrides).forEach(([key, value]) => {
    if (value && map[key] === undefined) {
      map[key] = value;
    }
  });
  return map;
}

export default function MeetingDetail({
  meeting,
  fileType = 'audio',
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
  mediaRef: externalMediaRef,
  onSeek: externalOnSeek,
}) {
  const internalMediaRef = useRef(null);
  const mediaRef = externalMediaRef || internalMediaRef;
  const meetingId = meeting?.id;

  const [selectedChunk, setSelectedChunk] = useState(null);
  const [committedSpeakerNameMap, setCommittedSpeakerNameMap] = useState(() =>
    buildInitialSpeakerNameMap(speakers, meetingId)
  );
  const [speakerNameMap, setSpeakerNameMap] = useState(() =>
    buildInitialSpeakerNameMap(speakers, meetingId)
  );
  const [renameModalSpeaker, setRenameModalSpeaker] = useState(null);

  useEffect(() => {
    const initialMap = buildInitialSpeakerNameMap(speakers, meetingId);
    setCommittedSpeakerNameMap(initialMap);
    setSpeakerNameMap(initialMap);
  }, [speakers, meetingId]);

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
          playRequest.catch(() => { });
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

  const handleSaveSpeakersFromPanel = useCallback(
    async (updatedSpeakers, applyToAll) => {
      if (typeof onSaveSpeakers === 'function') {
        await onSaveSpeakers(updatedSpeakers, applyToAll);
      }
      const nextMap = { ...committedSpeakerNameMap };
      updatedSpeakers.forEach((spk) => {
        if (spk?.id && spk?.name?.trim()) {
          nextMap[spk.id] = spk.name.trim();
        }
      });
      saveSpeakerNameOverrides(meetingId, nextMap);
      setCommittedSpeakerNameMap(nextMap);
      setSpeakerNameMap(nextMap);
    },
    [committedSpeakerNameMap, meetingId, onSaveSpeakers]
  );

  const handleApplySpeakerRename = useCallback(
    async (speakerId, newName, applyToAll) => {
      const trimmed = String(newName || '').trim();
      if (!trimmed) return;

      const targetSpeaker = speakers.find((s) => s.id === speakerId);
      const originalLabel =
        targetSpeaker?.originalLabel ||
        renameModalSpeaker?.originalLabel ||
        speakerId;

      if (typeof onSaveSpeakers === 'function') {
        await onSaveSpeakers(
          [
            {
              ...(targetSpeaker || {}),
              id: speakerId,
              originalLabel,
              name: trimmed,
            },
          ],
          applyToAll
        );
      }

      const nextMap = {
        ...speakerNameMap,
        [speakerId]: trimmed,
      };
      saveSpeakerNameOverrides(meetingId, nextMap);
      setSpeakerNameMap(nextMap);
      setCommittedSpeakerNameMap((prev) => ({
        ...prev,
        [speakerId]: trimmed,
      }));
    },
    [meetingId, onSaveSpeakers, renameModalSpeaker, speakerNameMap, speakers]
  );

  const modalSampleUtterances = useMemo(() => {
    if (!renameModalSpeaker) return [];
    if (Array.isArray(renameModalSpeaker.sampleUtterances) && renameModalSpeaker.sampleUtterances.length > 0) {
      return renameModalSpeaker.sampleUtterances;
    }
    const matched = speakers.find((s) => s.id === renameModalSpeaker.id);
    return (matched?.segments || [])
      .map((seg) => seg.text?.trim())
      .filter(Boolean)
      .slice(0, 2);
  }, [renameModalSpeaker, speakers]);

  const transcriptElement = (
    <TranscriptEditor
      meetingId={meetingId}
      speakers={speakers}
      speakerNameMap={speakerNameMap}
      selectedChunk={selectedChunk}
      currentTime={currentTime}
      onSelectChunk={setSelectedChunk}
      onSeekSegment={seekToSegment}
      onRequestRenameSpeaker={setRenameModalSpeaker}
    />
  );

  return (
    <div className="w-full min-w-0 h-full flex flex-col xl:flex-row gap-5 items-stretch pb-6">
      {/* CỘT TRÁI: TRANSCRIPT Panel */}
      <div className="w-full min-w-0 xl:w-[46%] flex flex-col min-h-[550px]">
        {fileType === 'video' ? (
          <div className="flex flex-col gap-4 h-full">
            <MeetingVideoPlayer
              meetingId={meetingId}
              fileName={meeting?.fileName || meeting?.title}
              mimeType={meeting?.mimeType}
              fileType={fileType}
              mediaRef={mediaRef}
              durationSeconds={meeting?.durationSeconds}
              onTimeUpdate={onTimeUpdate}
              onEnded={onEnded}
            />
            <div className="flex-1 min-h-[350px]">{transcriptElement}</div>
          </div>
        ) : (
          transcriptElement
        )}
      </div>

      {/* CỘT PHẢI: Không gian phân tích AI (Tabs AI Summary, Task, Transcript & Người nói) */}
      <div className="w-full min-w-0 xl:w-[54%] flex flex-col min-h-[550px]">
        <MeetingTabs
          meetingId={meetingId}
          fileType={fileType}
          speakers={speakers}
          currentTime={currentTime}
          onSeekSegment={seekToSegment}
          onSaveSpeakers={handleSaveSpeakersFromPanel}
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
          baselineSpeakerNameMap={committedSpeakerNameMap}
          onSpeakerNameMapChange={setSpeakerNameMap}
        />
      </div>

      <RenameSpeakerModal
        isOpen={Boolean(renameModalSpeaker)}
        speaker={renameModalSpeaker}
        sampleUtterances={modalSampleUtterances}
        onClose={() => setRenameModalSpeaker(null)}
        onApply={handleApplySpeakerRename}
      />
    </div>
  );
}
