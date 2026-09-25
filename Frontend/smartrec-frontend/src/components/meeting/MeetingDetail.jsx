import React, { useState } from 'react';
import AudioAiStatus from './AudioAiStatus';
import SpeakerList from './SpeakerList';
import SpeakerManagementPanel from './SpeakerManagementPanel';
import RenameSpeakerModal from './RenameSpeakerModal';

export default function MeetingDetail({ 
  audioAiStatus = 'completed', 
  speakers = [],
  onRetryAudioAi,
  onSaveSpeakers 
}) {
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(speakers[0]?.id || '1');
  const [activeModalSpeaker, setActiveModalSpeaker] = useState(null);

  const handleOpenRename = (speaker) => {
    setActiveModalSpeaker(speaker);
  };

  const handleCloseRename = () => {
    setActiveModalSpeaker(null);
  };

  const handleApplyRename = (speakerId, newName, applyToAll) => {
    if (onSaveSpeakers) {
      const updated = speakers.map(s => 
        s.id === speakerId ? { ...s, name: newName } : s
      );
      onSaveSpeakers(updated);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* 1. Audio AI Status Banner */}
      <AudioAiStatus status={audioAiStatus} onRetry={onRetryAudioAi} />
      
      {/* 2. Main Two-Column Layout */}
      {audioAiStatus !== 'failed' && (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Left Column: Speaker Sidebar (~280px) */}
          <div className="w-full lg:w-72 shrink-0">
            <SpeakerList
              status={audioAiStatus}
              speakers={speakers}
              selectedSpeakerId={selectedSpeakerId}
              onSelectSpeaker={setSelectedSpeakerId}
              onOpenRename={handleOpenRename}
            />
          </div>

          {/* Right Column: Speaker Segments / History Panel */}
          <div className="flex-1 w-full min-w-0">
            <SpeakerManagementPanel
              initialSpeakers={speakers}
              onSave={onSaveSpeakers}
            />
          </div>
        </div>
      )}

      {/* 3. Rename Speaker Modal (matching Figma) */}
      <RenameSpeakerModal
        isOpen={Boolean(activeModalSpeaker)}
        speaker={activeModalSpeaker}
        onClose={handleCloseRename}
        onApply={handleApplyRename}
      />
    </div>
  );
}
