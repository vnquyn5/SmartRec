import React, { useState } from 'react';
import SlideOcrTab from './SlideOcrTab';
import MeetingTasksTab from './MeetingTasksTab';
import MeetingSummaryTab from './MeetingSummaryTab';
import SpeakerManagementPanel from './SpeakerManagementPanel';

export default function MeetingTabs({ fileType = 'video', speakers = [], onSaveSpeakers }) {
  // Mặc định mở tab Slide nếu là video để khớp giao diện Figma
  const [activeTab, setActiveTab] = useState(fileType === 'video' ? 'slide' : 'summary');

  // Khai báo các tab theo yêu cầu leader
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
      <div className="flex items-center gap-6 px-6 border-b border-[#18233c] shrink-0 bg-[#0a1122]">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-3.5 flex items-center gap-2 text-xs font-semibold border-b-2 transition-all relative top-[1px] ${
                isActive
                  ? 'border-[#38bdf8] text-[#38bdf8]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
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
        {activeTab === 'speaker' && (
          <div className="h-full">
            <SpeakerManagementPanel initialSpeakers={speakers} onSave={onSaveSpeakers} />
          </div>
        )}
        {activeTab === 'slide' && <SlideOcrTab />}
      </div>
    </div>
  );
}