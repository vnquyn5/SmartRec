import React from "react";
import { useNavigate } from "react-router-dom";
const statusColors = {
  "Đã xử lý": { bg: "rgba(34,197,94,0.14)", text: "#22c55e" },
  "Đang xử lý": { bg: "rgba(62,137,255,0.14)", text: "#3e89ff" },
  Lỗi: { bg: "rgba(255,77,93,0.14)", text: "#ff4d5d" },
  "Chờ xử lý": { bg: "rgba(148,163,184,0.14)", text: "#94a3b8" },
};

const dotColors = {
  "Đã xử lý": "#22c55e",
  "Đang xử lý": "#3e89ff",
  Lỗi: "#ff4d5d",
  "Chờ xử lý": "#94a3b8",
};

const statusLabels = {
  COMPLETED: "Đã xử lý",
  PROCESSING: "Đang xử lý",
  FAILED: "Lỗi",
  PENDING: "Chờ xử lý",
};

const statusOptions = [
  { value: "", label: "Tất cả" },
  { value: "COMPLETED", label: "Đã xử lý" },
  { value: "PROCESSING", label: "Đang xử lý" },
  { value: "FAILED", label: "Lỗi" },
  { value: "PENDING", label: "Chờ xử lý" },
];

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(value))
    : "--";

const formatDuration = (seconds) => {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) return "--";
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const remainingSeconds = duration % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
};

const RecentMeetings = ({
  meetings = [],
  totalMeetings = 0,
  pageNumber = 0,
  pageSize = 4,
  totalPages = 0,
  first = true,
  last = true,
  status = "",
  onStatusChange,
  onPageChange,
  isLoading = false,
}) => {
  const navigate = useNavigate();
  const recentMeetings = meetings.map((meeting) => ({
    ...meeting,
    name: meeting.fileName || "Untitled meeting",
    date: formatDate(meeting.createdAt),
    duration: formatDuration(meeting.durationSeconds),
    statusText: statusLabels[meeting.status] || meeting.status || "Chờ xử lý",
  }));
  const firstItem =
    totalMeetings === 0 ? 0 : pageNumber * pageSize + 1;
  const lastItem = Math.min((pageNumber + 1) * pageSize, totalMeetings);

  return (
    <div
      className="meetings-card"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <div className="meetings-header">
        <h3>Cuộc họp gần đây</h3>
        <div className="meetings-filter">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1 2h12M3 7h8M5 12h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span>Trạng thái:</span>
          <select
            value={status}
            onChange={(e) => onStatusChange?.(e.target.value)}
            disabled={isLoading}
          >
            {statusOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="meetings-table-wrap" style={{ flex: 1 }}>
        <table className="meetings-table">
          <thead>
            <tr>
              <th>TÊN CUỘC HỌP</th>
              <th>NGÀY</th>
              <th>THỜI LƯỢNG</th>
              <th>TRẠNG THÁI</th>
              <th>HÀNH ĐỘNG</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: pageSize }, (_, index) => (
                <tr key={`loading-${index}`}>
                  <td colSpan="5">
                    <div className="dashboard-row-skeleton" />
                  </td>
                </tr>
              ))}
            {!isLoading && recentMeetings.map((m) => {
              const sc = statusColors[m.statusText] || statusColors["Đang xử lý"];
              return (
                <tr key={m.id}>
                  <td>
                    <div className="meeting-name-cell" title={m.name}>
                      <span
                        className="meeting-dot"
                        style={{ background: dotColors[m.statusText] }}
                      />
                      <span className="meeting-name-text">{m.name}</span>
                    </div>
                  </td>
                  <td>{m.date}</td>
                  <td>{m.duration}</td>
                  <td>
                    <span
                      className="status-badge"
                      style={{ background: sc.bg, color: sc.text }}
                    >
                      {m.statusText}
                    </span>
                  </td>
                  <td>
                    <div className="meeting-actions">
                      <button
                        className="action-btn"
                        title="View"
                        onClick={() => navigate(`/meeting/${m.id || 123}`)}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                          />
                          <circle
                            cx="8"
                            cy="8"
                            r="2"
                            stroke="currentColor"
                            strokeWidth="1.2"
                          />
                        </svg>
                      </button>
                      <button className="action-btn" title="Refresh">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M13.5 2.5v4h-4M2.5 13.5v-4h4"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M4.5 5.5A5 5 0 0113.5 6.5M11.5 10.5a5 5 0 01-9-1"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!isLoading && recentMeetings.length === 0 && (
              <tr>
                <td colSpan="5" className="meetings-empty-cell">
                  Không có cuộc họp phù hợp.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="meetings-footer">
        <span className="meetings-count">
          {isLoading
            ? "Đang tải cuộc họp..."
            : `Đang xem ${firstItem}-${lastItem} of ${totalMeetings} cuộc họp`}
        </span>
        <div className="meetings-pagination">
          <button
            className="pagination-btn"
            disabled={first || isLoading}
            onClick={() => onPageChange?.(Math.max(0, pageNumber - 1))}
          >
            Trước
          </button>
          <button
            className="pagination-btn"
            disabled={last || isLoading || totalPages <= 1}
            onClick={() => onPageChange?.(pageNumber + 1)}
          >
            Sau
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecentMeetings;
