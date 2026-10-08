import React, { useState } from 'react';
import SlideOcrTab from './SlideOcrTab';
import MeetingTasksTab from './MeetingTasksTab';
import MeetingSummaryTab from './MeetingSummaryTab';
import SpeakerManagementPanel from './SpeakerManagementPanel';
import AudioAiStatus from './AudioAiStatus';
import TranscriptPanel from './TranscriptPanel';

export default function MeetingTabs({ fileType = 'video', speakers = [], onSaveSpeakers, onSeekSegment, aiStatus = 'processing', jobLoading, aiError, speakerError, speakerLoading, onRetry, onPause, onResume, onCancel, lifecycleAction, onStartProcessing, startingProcess, retrying }) {
  const [activeTab, setActiveTab] = useState('speaker');

  // Khai báo các tab theo yêu cầu 
  const tabs = [
    {
      id: 'summary',
      label: 'AI Summary',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
    },
    {
      id: 'task',
      label: 'Task',
      count: 3,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      ),
    },
    {
      id: 'speaker',
      label: 'Speaker',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
    {
      id: 'transcript',
      label: 'Transcript',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
  ];

  // Logic bắt buộc của Leader: Nếu là video thì có tab Slide OCR, nếu audio thì không có
  if (fileType === 'video') {
    tabs.push({
      id: 'slide',
      label: 'Slide Keyframes & OCR',
      count: 6,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      ),
    });
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#090f1d] border border-[#1b2640] rounded-2xl overflow-hidden shadow-xl">
      {/* Tab Navigation Header chuẩn Figma */}
      <div className="flex items-center gap-6 px-6 border-b border-[#18233c] shrink-0 bg-[#0a1122] overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-3.5 flex items-center gap-2 text-xs font-semibold border-b-2 transition-all relative top-[1px] whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-[#38bdf8] text-[#38bdf8]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="shrink-0">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                    isActive
                      ? 'bg-[#2563eb] text-white shadow-sm'
                      : 'bg-[#18243c] text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content Display Area */}
      <div className="flex-1 overflow-y-auto p-5 min-h-0 bg-[#090f1d]">
        {activeTab === 'summary' && <MeetingSummaryTab />}
        {activeTab === 'task' && <MeetingTasksTab />}
        {activeTab === 'transcript' && <TranscriptPanel onSeek={onSeek} />}
        {activeTab === 'speaker' && (
          <div className="h-full flex flex-col gap-4">
            {/* Audio AI Status Banner (Đáp ứng Task 2.15.1) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <AudioAiStatus status={aiStatus} errorMessage={aiError} retrying={retrying} onRetry={onRetry} onPause={onPause} onResume={onResume} onCancel={onCancel} lifecycleAction={lifecycleAction} onStartProcessing={onStartProcessing} startingProcess={startingProcess} />
                {jobLoading && <p className="mt-2 text-[11px] text-slate-400">Đang tải trạng thái xử lý…</p>}
              </div>
            </div>

            {aiStatus === 'unprocessed' ? (
              <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-5 py-8 text-center text-sm text-slate-400">
                Cuộc họp chưa được xử lý AI.
              </p>
            ) : aiStatus === 'processing' || aiStatus === 'queued' ? (
              <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-5 py-8 text-center text-sm text-slate-400">
                Hệ thống đang phân tích âm thanh và nhận diện người nói.
              </p>
            ) : aiStatus === 'failed' ? (
              <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-5 py-8 text-center text-sm text-rose-200">
                Xử lý âm thanh thất bại. Kết quả người nói không khả dụng.
              </p>
            ) : aiStatus === 'error' ? (
              <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-5 py-8 text-center text-sm text-amber-200">
                Không thể tải trạng thái hoặc kết quả Audio AI.
              </p>
            ) : speakerLoading ? (
              <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-5 py-8 text-center text-sm text-slate-400">
                Đang tải kết quả người nói…
              </p>
            ) : speakerError ? (
              <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-5 py-8 text-center text-sm text-amber-200">
                {speakerError}
              </p>
            ) : speakers.length === 0 ? (
              <div className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-5 py-8 text-center">
                <h3 className="text-sm font-semibold text-white">Không phát hiện người nói</h3>
                <p className="mt-2 text-sm text-slate-400">Hệ thống đã hoàn tất xử lý nhưng không tìm thấy đoạn phát ngôn phù hợp.</p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-3">
                  <h2 className="text-sm font-semibold text-white">Người nói</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {speakers.length} người nói · {speakers.reduce((total, speaker) => total + speaker.segments.length, 0)} đoạn phát ngôn
                  </p>
                </div>
                <SpeakerManagementPanel key={speakers.map((speaker) => speaker.id).join('|')} initialSpeakers={speakers} onSave={onSaveSpeakers} onSeekSegment={onSeekSegment} />
              </>
            )}
          </div>
        )}
        {activeTab === 'slide' && <SlideOcrTab />}
      </div>
    </div>
  );
}
