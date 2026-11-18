import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import LivePreviewExporter from '../../components/exporter/LivePreviewExporter';
import { useAuth } from '../../features/auth/AuthProvider';
import { api } from '../../lib/http/client';
import { getAllMeetings } from '../../services/meetingService';
import { groupSpeakerSegments } from '../../services/documentExporterService';

const DEMO_FALLBACK_MEETING = {
  id: 'demo-meeting',
  fileName: 'Q4_Product_Roadmap_Review.mp4',
  title: 'Q4 Product Roadmap & SmartRec Sprint 4 Review',
  durationSeconds: 2940,
  status: 'COMPLETED',
  createdAt: '2026-11-18T02:15:00Z',
};

export default function DocumentExportPage() {
  const { user } = useAuth() || {};
  const [searchParams, setSearchParams] = useSearchParams();
  const queryMeetingId = searchParams.get('meetingId') || '';

  const [meetings, setMeetings] = useState([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState(queryMeetingId);
  const [speakers, setSpeakers] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [dataMode, setDataMode] = useState('api');

  const loadMeetings = useCallback(async () => {
    setLoadingMeetings(true);
    try {
      const response = await getAllMeetings();
      const list = Array.isArray(response?.content) ? response.content : [];
      if (list.length > 0) {
        setMeetings(list);
        setDataMode('api');
        setSelectedMeetingId((prev) => {
          if (prev && list.some((m) => m.id === prev)) return prev;
          if (queryMeetingId && list.some((m) => m.id === queryMeetingId)) return queryMeetingId;
          const completed = list.find(
            (m) => String(m.status || '').toUpperCase() === 'COMPLETED'
          );
          return (completed || list[0]).id;
        });
      } else {
        setMeetings([DEMO_FALLBACK_MEETING]);
        setDataMode('demo');
        setSelectedMeetingId(DEMO_FALLBACK_MEETING.id);
      }
    } catch {
      setMeetings([DEMO_FALLBACK_MEETING]);
      setDataMode('demo');
      setSelectedMeetingId(DEMO_FALLBACK_MEETING.id);
    } finally {
      setLoadingMeetings(false);
    }
  }, [queryMeetingId]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedMeetingId || selectedMeetingId === DEMO_FALLBACK_MEETING.id) {
      setSpeakers([]);
      return;
    }

    setLoadingSpeakers(true);
    api
      .get(`/meetings/${selectedMeetingId}/speakers`)
      .then((res) => {
        if (cancelled) return;
        const rawList = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        const grouped = groupSpeakerSegments(rawList);
        setSpeakers(grouped);
      })
      .catch(() => {
        if (!cancelled) setSpeakers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSpeakers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMeetingId]);

  const activeMeeting = useMemo(
    () =>
      meetings.find((m) => m.id === selectedMeetingId) ||
      meetings[0] ||
      DEMO_FALLBACK_MEETING,
    [meetings, selectedMeetingId]
  );

  const handleMeetingSelect = (nextId) => {
    setSelectedMeetingId(nextId);
    setSearchParams(nextId ? { meetingId: nextId } : {}, { replace: true });
  };

  return (
    <div className="min-h-full bg-[#070b19] text-slate-100 p-4 sm:p-6 flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#162038] pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Live Preview Document Exporter
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#13203d] text-[#38bdf8] border border-[#243b6b]">
              {dataMode === 'api' ? 'Workspace Live Data' : 'Demo Preview Mode'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Chọn cuộc họp, tùy chỉnh bố cục biên bản và xem trước trực tiếp trước khi xuất PDF, Word, Markdown hoặc JSON.
          </p>
        </div>

        {/* Meeting Selector */}
        <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <span className="text-slate-400 whitespace-nowrap">Cuộc họp:</span>
            <select
              value={activeMeeting?.id || ''}
              disabled={loadingMeetings}
              onChange={(e) => handleMeetingSelect(e.target.value)}
              aria-label="Chọn cuộc họp để xuất tài liệu"
              className="min-w-[230px] max-w-xs px-3 py-2 rounded-xl bg-[#0c1324] border border-[#1b2742] text-xs text-slate-100 focus:outline-none focus:border-[#38bdf8]"
            >
              {meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fileName || m.title || m.id}
                </option>
              ))}
            </select>
          </label>
          {loadingSpeakers && (
            <span className="text-[11px] text-[#38bdf8]">Đang đồng bộ transcript...</span>
          )}
        </div>
      </div>

      <LivePreviewExporter
        meeting={activeMeeting}
        speakers={speakers}
        defaultAuthorName={user?.name || ''}
      />
    </div>
  );
}
