import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
const statusColors = {
  Processed: { bg: 'rgba(34,197,94,0.14)', text: '#22c55e' },
  Processing: { bg: 'rgba(62,137,255,0.14)', text: '#3e89ff' },
  Failed: { bg: 'rgba(255,77,93,0.14)', text: '#ff4d5d' },
  Pending: { bg: 'rgba(148,163,184,0.14)', text: '#94a3b8' },
};

const dotColors = {
  Processed: '#22c55e',
  Processing: '#3e89ff',
  Failed: '#ff4d5d',
  Pending: '#94a3b8',
};

const statusLabels = {
  COMPLETED: 'Processed',
  PROCESSING: 'Processing',
  FAILED: 'Failed',
  PENDING: 'Pending',
};

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date(value))
    : '--';

const formatDuration = (seconds) => {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) return '--';
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const remainingSeconds = duration % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
};

const RecentMeetings = ({ meetings = [], totalMeetings = 0, isLoading = false }) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const recentMeetings = meetings.slice(0, 4).map((meeting) => ({
    ...meeting,
    name: meeting.title || meeting.fileName || 'Untitled meeting',
    date: formatDate(meeting.createdAt),
    duration: formatDuration(meeting.durationSeconds),
    status: statusLabels[meeting.status] || meeting.status || 'Pending',
  }));
  const filtered = filter === 'All'
    ? recentMeetings
    : recentMeetings.filter((meeting) => meeting.status === filter);

  return (
    <div className="meetings-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="meetings-header">
        <h3>Recent Meetings</h3>
        <div className="meetings-filter">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 2h12M3 7h8M5 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Status:</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option>All</option>
            <option>Processed</option>
            <option>Processing</option>
            <option>Failed</option>
            <option>Pending</option>
          </select>
        </div>
      </div>

      <div className="meetings-table-wrap" style={{ flex: 1 }}>
        <table className="meetings-table">
          <thead>
            <tr>
              <th>MEETING NAME</th>
              <th>DATE</th>
              <th>DURATION</th>
              <th>STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const sc = statusColors[m.status] || statusColors.Processing;
              return (
                <tr key={m.id}>
                  <td>
                    <div className="meeting-name-cell">
                      <span className="meeting-dot" style={{ background: dotColors[m.status] }} />
                      {m.name}
                    </div>
                  </td>
                  <td>{m.date}</td>
                  <td>{m.duration}</td>
                  <td>
                    <span className="status-badge" style={{ background: sc.bg, color: sc.text }}>
                      {m.status}
                    </span>
                  </td>
                  <td>
                    <div className="meeting-actions">
                      <button className="action-btn" title="View" onClick={() => navigate(`/meeting/${m.id || 123}`)}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.2" />
                          <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                      </button>
                      <button className="action-btn" title="Refresh">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M4.5 5.5A5 5 0 0113.5 6.5M11.5 10.5a5 5 0 01-9-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="meetings-footer">
          <span className="meetings-count">
            {isLoading ? 'Loading meetings...' : `Showing 1-${filtered.length} of ${totalMeetings} meetings`}
          </span>
        <div className="meetings-pagination">
          <button className="pagination-btn" disabled>Previous</button>
          <button className="pagination-btn">Next</button>
        </div>
      </div>
    </div>
  );
};

export default RecentMeetings;
