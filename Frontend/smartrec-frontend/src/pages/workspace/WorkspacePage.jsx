import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteMeeting, getAllMeetings } from "../../services/meetingService";
import "./WorkspacePage.css";

const POLL_INTERVAL_MS = 2500;
const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "PROCESSING", "RUNNING", "RETRYING"]);
const WORKSPACE_STATUSES = new Set([
  ...ACTIVE_STATUSES,
  "COMPLETED",
  "FAILED",
  "DLQ",
  "CANCELLED",
]);

const STATUS_PRESENTATION = {
  PENDING: { label: "Chờ xử lý", className: "status-pending" },
  QUEUED: { label: "Chờ xử lý", className: "status-pending" },
  RUNNING: { label: "Đang xử lý", className: "status-processing" },
  PROCESSING: { label: "Đang xử lý", className: "status-processing" },
  RETRYING: { label: "Đang thử lại", className: "status-processing" },
  COMPLETED: { label: "Hoàn tất", className: "status-completed" },
  SUCCESS: { label: "Hoàn tất", className: "status-completed" },
  SUCCEEDED: { label: "Hoàn tất", className: "status-completed" },
  FAILED: { label: "Thất bại", className: "status-failed" },
  CANCELLED: { label: "Đã hủy", className: "status-terminal" },
  DLQ: { label: "Xử lý lỗi", className: "status-failed" },
};

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "Chưa có ngày tải lên";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa có ngày tải lên";
  return date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });
}

function getMeetingTitle(meeting) {
  return meeting.fileName || meeting.title || "Cuộc họp chưa có tên";
}

function getStatus(meeting) {
  const key = String(meeting.status || "").toUpperCase();
  return STATUS_PRESENTATION[key] || { label: key || "Chưa xác định", className: "status-terminal" };
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const timerRef = useRef(null);
  const requestRef = useRef(null);
  const mountedRef = useRef(false);

  const fetchMeetings = useCallback(async ({ initial = false } = {}) => {
    if (requestRef.current) return requestRef.current;
    if (initial) setLoading(true);

    const request = getAllMeetings()
      .then((response) => {
        if (!mountedRef.current) return;
        const data = Array.isArray(response?.content) ? response.content : [];
        setMeetings(data.filter((meeting) =>
          WORKSPACE_STATUSES.has(String(meeting?.status || "").trim().toUpperCase()),
        ));
        setError("");
      })
      .catch((fetchError) => {
        if (!mountedRef.current) return;
        setError(fetchError?.response?.data?.message || "Không thể tải danh sách cuộc họp.");
      })
      .finally(() => {
        requestRef.current = null;
        if (mountedRef.current) setLoading(false);
      });
    requestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchMeetings({ initial: true });
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timerRef.current);
    };
  }, [fetchMeetings]);

  useEffect(() => {
    window.clearTimeout(timerRef.current);
    const hasActive = meetings.some((meeting) => ACTIVE_STATUSES.has(String(meeting.status || "").toUpperCase()));
    if (!hasActive) return undefined;

    let cancelled = false;
    const schedule = () => {
      timerRef.current = window.setTimeout(async () => {
        if (cancelled || document.visibilityState === "hidden") {
          if (!cancelled) schedule();
          return;
        }
        await fetchMeetings();
        if (!cancelled) schedule();
      }, POLL_INTERVAL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timerRef.current);
    };
  }, [meetings, fetchMeetings]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") fetchMeetings();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [fetchMeetings]);

  const visibleMeetings = useMemo(() => {
    const keyword = searchQuery.trim().toLocaleLowerCase("vi");
    if (!keyword) return meetings;
    return meetings.filter((meeting) => getMeetingTitle(meeting).toLocaleLowerCase("vi").includes(keyword));
  }, [meetings, searchQuery]);

  const handleDelete = async (id, event) => {
    event.stopPropagation();
    if (!window.confirm("Bạn có chắc muốn xóa cuộc họp này?")) return;
    try {
      await deleteMeeting(id);
      setMeetings((current) => current.filter((meeting) => meeting.id !== id));
    } catch (deleteError) {
      window.alert(deleteError?.response?.data?.message || "Không thể xóa cuộc họp.");
    }
  };

  const handleShare = async (id, event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meeting/${id}`);
      window.alert("Đã sao chép liên kết cuộc họp.");
    } catch {
      window.alert("Không thể sao chép liên kết cuộc họp.");
    }
  };

  return (
    <div className="workspace-container">
      <div className="workspace-header">
        <h2 className="workspace-title">Cuộc họp đã xử lý</h2>
        <p className="workspace-description">
          Theo dõi trạng thái xử lý và xem kết quả của các cuộc họp trong không gian của bạn.
        </p>
        <label className="workspace-search">
          <span className="sr-only">Tìm cuộc họp</span>
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Tìm theo tên file/cuộc họp" />
        </label>
      </div>

      {loading && meetings.length === 0 ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : error && meetings.length === 0 ? (
        <div className="empty-state" role="alert">
          <p>{error}</p>
          <button onClick={() => fetchMeetings({ initial: true })} className="btn-action btn-insights">Thử lại</button>
        </div>
      ) : (
        <div className="meetings-grid">
          {visibleMeetings.map((meeting) => {
            const status = getStatus(meeting);
            const duration = formatDuration(meeting.durationSeconds);
            const title = getMeetingTitle(meeting);
            return (
              <article key={meeting.id} className="meeting-card" onClick={() => navigate(`/meeting/${meeting.id}`)}>
                <div className="meeting-card-thumbnail">
                  <div className="thumbnail-placeholder" aria-label="Không có ảnh xem trước">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="3" /><path d="M7 2v20M17 2v20M2 12h20" />
                    </svg>
                  </div>
                  {duration && <span className="duration-badge">{duration}</span>}
                </div>
                <div className="meeting-card-content">
                  <div className="meeting-title-row">
                    <h3 className="meeting-card-title" title={title}>{title}</h3>
                    <span className={`status-badge ${status.className}`}>
                      {ACTIVE_STATUSES.has(String(meeting.status || "").toUpperCase()) && <span className="status-spinner" aria-hidden="true" />}
                      {!ACTIVE_STATUSES.has(String(meeting.status || "").toUpperCase()) && <span className="status-dot" />}
                      {status.label}
                    </span>
                  </div>
                  <div className="meeting-card-meta">
                    <div className="meta-item">
                      <svg className="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                      <span>{formatDate(meeting.createdAt)}</span>
                    </div>
                  </div>
                  <div className="meeting-card-actions">
                    <button className="btn-action btn-insights" onClick={(event) => { event.stopPropagation(); navigate(`/meeting/${meeting.id}`); }}>Xem chi tiết</button>
                    <button className="btn-action btn-icon-only" title="Chia sẻ" aria-label="Chia sẻ" onClick={(event) => handleShare(meeting.id, event)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4m0-11-6.8 4" /></svg>
                    </button>
                    <button className="btn-action btn-icon-only btn-delete" title="Xóa" aria-label="Xóa" onClick={(event) => handleDelete(meeting.id, event)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></svg>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          <button type="button" className="meeting-card add-another-card" onClick={() => navigate("/upload")}>
            <span className="add-another-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
            <span className="add-another-text">Tải lên cuộc họp khác</span>
            <span className="add-another-subtext">Nhấn để chọn tệp và bắt đầu xử lý.</span>
          </button>
          {visibleMeetings.length === 0 && <p className="workspace-no-results">{meetings.length ? "Không tìm thấy cuộc họp phù hợp." : "Chưa có cuộc họp nào."}</p>}
        </div>
      )}
    </div>
  );
}
