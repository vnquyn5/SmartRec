import React, { useState } from 'react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import MeetingDetail from '../../components/meeting/MeetingDetail';

export default function MeetingDetailPage() {
  const [aiStatus, setAiStatus] = useState('completed'); 
  const [speakers, setSpeakers] = useState([
    {
      id: '1',
      originalLabel: 'Speaker 1',
      name: 'Anh Quyền',
      segments: [
        { start: '00:00', end: '00:15' },
        { start: '00:32', end: '00:48' },
        { start: '01:10', end: '01:25' },
      ]
    },
    {
      id: '2',
      originalLabel: 'Speaker 2',
      name: 'Chị Lan',
      segments: [
        { start: '00:15', end: '00:32' },
        { start: '01:25', end: '01:42' },
      ]
    },
    {
      id: '3',
      originalLabel: 'Speaker 3',
      name: 'Anh Hùng',
      segments: [
        { start: '01:45', end: '02:10' },
      ]
    },
    {
      id: '4',
      originalLabel: 'Speaker 4',
      name: 'Speaker 4',
      segments: [
        { start: '02:15', end: '02:40' },
      ]
    }
  ]);

  const handleSaveSpeakers = async (updatedSpeakers) => {
    setSpeakers(prev => prev.map(s => {
      const match = updatedSpeakers.find(u => u.id === s.id);
      return match ? { ...s, name: match.name } : s;
    }));
  };

  return (
    <DashboardLayout>
      <div className="w-full max-w-7xl mx-auto px-4 py-6 font-sans">
        {/* Page Top Header with discrete State Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Chi tiết cuộc họp</h1>
            <p className="text-xs text-slate-400 mt-1">
              Quản lý định danh người nói và kiểm tra kết quả xử lý từ Audio AI
            </p>
          </div>
          
          {/* Quick Demo Switcher */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0c101d] border border-[#1e2742] rounded-xl self-start sm:self-auto">
            <span className="text-[11px] font-semibold text-slate-400">Trạng thái:</span>
            <select 
              className="bg-[#141a2e] text-white text-xs font-medium px-2 py-1 rounded-lg border border-[#25355e] focus:outline-none focus:border-[#38bdf8] cursor-pointer"
              value={aiStatus} 
              onChange={(e) => setAiStatus(e.target.value)}
            >
              <option value="completed">Completed (Đã nhận diện)</option>
              <option value="processing">Processing (Đang phân tích)</option>
              <option value="failed">Failed (Lỗi xử lý)</option>
              <option value="empty">Empty (Không có người nói)</option>
            </select>
          </div>
        </div>

        {/* Meeting Detail Component */}
        <MeetingDetail 
          audioAiStatus={aiStatus === 'empty' ? 'completed' : aiStatus}
          speakers={aiStatus === 'empty' ? [] : speakers}
          onRetryAudioAi={() => setAiStatus('processing')}
          onSaveSpeakers={handleSaveSpeakers}
        />
      </div>
    </DashboardLayout>
  );
}
