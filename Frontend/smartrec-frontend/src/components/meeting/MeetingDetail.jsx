import React from 'react';
import MeetingVideoPlayer from './MeetingVideoPlayer';
import TranscriptPanel from './TranscriptPanel';
import MeetingTabs from './MeetingTabs';

export default function MeetingDetail({ 
  fileType = 'video', 
  speakers = [],
  onSaveSpeakers 
}) {
  const [currentVideoTime, setCurrentVideoTime] = React.useState('12:45');

  return (
    <div className="w-full h-full flex flex-col xl:flex-row gap-5 items-stretch pb-6">
      {/* CỘT TRÁI: Video Player (trên) + Transcript (dưới) chuẩn Figma */}
      <div className="w-full xl:w-[48%] flex flex-col gap-4">
        <MeetingVideoPlayer currentTime={currentVideoTime} duration="28:30" />
        <TranscriptPanel onSeek={(time) => setCurrentVideoTime(time)} />
      </div>

      {/* CỘT PHẢI: Hệ thống Tabs (AI Summary, Task, Speaker, Slide Keyframes) */}
      <div className="w-full xl:w-[52%] flex flex-col min-h-[500px]">
        <MeetingTabs 
          fileType={fileType} 
          speakers={speakers}
          onSaveSpeakers={onSaveSpeakers}
        />
      </div>
    </div>
  );
}