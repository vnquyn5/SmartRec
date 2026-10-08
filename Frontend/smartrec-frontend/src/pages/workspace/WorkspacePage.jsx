import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelJob, deleteMeeting, getAllMeetings, getJob, pauseJob, resumeJob, retryJob } from "../../services/meetingService";
import { PauseIcon, PlayIcon, RefreshIcon } from "../../components/common/icons.jsx";
import "./WorkspacePage.css";

const POLL_INTERVAL_MS = 2500;
const MAX_PARALLEL_JOB_POLLS = 5;
const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "PROCESSING", "RUNNING", "RETRYING", "PAUSE_REQUESTED", "CANCEL_REQUESTED"]);
const TERMINAL_JOB_STATUSES = new Set(["COMPLETED", "SUCCESS", "SUCCEEDED", "FAILED", "DLQ", "CANCELLED"]);
const WORKSPACE_STATUSES = new Set([
  ...ACTIVE_STATUSES,
  "COMPLETED",
  "FAILED",
  "DLQ",
  "CANCELLED",
  "PAUSE_REQUESTED",
  "PAUSED",
  "CANCEL_REQUESTED",
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
  PAUSE_REQUESTED: { label: "Đang tạm dừng…", className: "status-processing" },
  PAUSED: { label: "Đã tạm dừng", className: "status-terminal" },
  CANCEL_REQUESTED: { label: "Đang hủy…", className: "status-processing" },
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
  const [busyJobId, setBusyJobId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const timerRef = useRef(null);
  const requestRef = useRef(null);
  const mountedRef = useRef(false);
  const terminalJobIdsRef = useRef(new Set());
  const jobActionInFlightRef = useRef(false);

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

  const activeJobs = meetings
    .filter((meeting) => ACTIVE_STATUSES.has(String(meeting.status || "").toUpperCase())
      && meeting.activeJobId && !terminalJobIdsRef.current.has(meeting.activeJobId))
    .map((meeting) => ({ meetingId: meeting.id, jobId: meeting.activeJobId }));
  const activeJobsKey = JSON.stringify(activeJobs);

  useEffect(() => {
    window.clearTimeout(timerRef.current);
    const jobsToPoll = JSON.parse(activeJobsKey);
    if (jobsToPoll.length === 0) return undefined;

    let cancelled = false;
    const schedule = () => {
      timerRef.current = window.setTimeout(async () => {
        if (cancelled || document.visibilityState === "hidden") {
          if (!cancelled) schedule();
          return;
        }
        let terminalObserved = false;
        for (let index = 0; index < jobsToPoll.length; index += MAX_PARALLEL_JOB_POLLS) {
          const batch = jobsToPoll.slice(index, index + MAX_PARALLEL_JOB_POLLS);
          await Promise.all(batch.map(async ({ meetingId, jobId }) => {
            if (cancelled || terminalJobIdsRef.current.has(jobId)) return;
            try {
              const job = await getJob(jobId);
              if (cancelled || !mountedRef.current) return;
              const jobStatus = String(job?.status || "").trim().toUpperCase();
              if (TERMINAL_JOB_STATUSES.has(jobStatus)) {
                terminalJobIdsRef.current.add(jobId);
                terminalObserved = true;
                setMeetings((current) => current.map((meeting) =>
                  meeting.id === meetingId && meeting.activeJobId === jobId
                    ? { ...meeting, status: jobStatus === "SUCCESS" || jobStatus === "SUCCEEDED" ? "COMPLETED" : jobStatus }
                    : meeting,
                ));
              } else if (ACTIVE_STATUSES.has(jobStatus) || jobStatus === "PAUSED") {
                terminalJobIdsRef.current.delete(jobId);
                setMeetings((current) => current.map((meeting) =>
                  meeting.id === meetingId && meeting.activeJobId === jobId
                    ? { ...meeting, status: jobStatus }
                    : meeting,
                ));
              }
            } catch {
              // Retry transient job status failures on the next scheduled pass.
            }
          }));
        }
        if (terminalObserved && !cancelled) await fetchMeetings();
        if (!cancelled) schedule();
      }, POLL_INTERVAL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timerRef.current);
    };
  }, [activeJobsKey, fetchMeetings]);

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

  const runJobAction = async (meeting, event, action, nextStatus) => {
    event.stopPropagation();
    if (!meeting.activeJobId || jobActionInFlightRef.current) return;
    jobActionInFlightRef.current = true;
    setBusyJobId(meeting.activeJobId);
    try {
      await action(meeting.activeJobId);
      setMeetings((current) => current.map((item) => item.id === meeting.id ? { ...item, status: nextStatus } : item));
    } catch (actionError) {
      window.alert(actionError?.response?.data?.message || "Không thể cập nhật trạng thái xử lý.");
    } finally {
      jobActionInFlightRef.current = false;
      setBusyJobId(null);
    }
  };

  const handleResume = (meeting, event) => {
    if (String(meeting.status || "").toUpperCase() !== "PAUSED") return;
    runJobAction(meeting, event, resumeJob, "QUEUED");
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
                    {String(meeting.status).toUpperCase() === "COMPLETED" && <button className="btn-action btn-icon-only" title="Chia sẻ" aria-label="Chia sẻ" onClick={(event) => handleShare(meeting.id, event)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4m0-11-6.8 4" /></svg>
                    </button>}
                    {ACTIVE_STATUSES.has(String(meeting.status).toUpperCase()) && meeting.status !== "PAUSE_REQUESTED" && meeting.status !== "CANCEL_REQUESTED" && <>
                      <button type="button" className="btn-action btn-icon-only" title="Tạm dừng xử lý" aria-label="Tạm dừng xử lý" disabled={busyJobId === meeting.activeJobId} onClick={(event) => runJobAction(meeting, event, pauseJob, "PAUSE_REQUESTED")}><PauseIcon className="h-4 w-4" /></button>
                      <button type="button" className="btn-action btn-icon-only" title="Hủy xử lý" aria-label="Hủy xử lý" disabled={busyJobId === meeting.activeJobId} onClick={(event) => runJobAction(meeting, event, cancelJob, "CANCEL_REQUESTED")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                    </>}
                    {meeting.status === "PAUSE_REQUESTED" && <>
                      <button type="button" className="btn-action btn-icon-only" title="Đang tạm dừng" aria-label="Tiếp tục xử lý (đang tạm dừng)" disabled><PlayIcon className="h-4 w-4" /></button>
                      <button type="button" className="btn-action btn-icon-only" title="Hủy xử lý" aria-label="Hủy xử lý" disabled={busyJobId === meeting.activeJobId} onClick={(event) => runJobAction(meeting, event, cancelJob, "CANCEL_REQUESTED")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                    </>}
                    {meeting.status === "CANCEL_REQUESTED" && <button type="button" className="btn-action btn-icon-only" title="Đang hủy" aria-label="Đang hủy xử lý" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>}
                    {meeting.status === "PAUSED" && <>
                      <button type="button" className="btn-action btn-icon-only" title="Tiếp tục xử lý" aria-label="Tiếp tục xử lý" disabled={!meeting.activeJobId || busyJobId === meeting.activeJobId} onClick={(event) => handleResume(meeting, event)}><PlayIcon className="h-4 w-4" /></button>
                      <button type="button" className="btn-action btn-icon-only" title="Hủy xử lý" aria-label="Hủy xử lý" disabled={busyJobId === meeting.activeJobId} onClick={(event) => runJobAction(meeting, event, cancelJob, "CANCEL_REQUESTED")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                    </>}
                    {["FAILED", "DLQ", "CANCELLED"].includes(String(meeting.status).toUpperCase()) && <button type="button" className="btn-action btn-icon-only" title="Thử xử lý lại" aria-label="Thử xử lý lại" disabled={busyJobId === meeting.activeJobId} onClick={(event) => runJobAction(meeting, event, retryJob, "RETRYING")}><RefreshIcon className="h-4 w-4" /></button>}
                    {["COMPLETED", "FAILED", "DLQ", "CANCELLED"].includes(String(meeting.status).toUpperCase()) && <button className="btn-action btn-icon-only btn-delete" title="Xóa" aria-label="Xóa" onClick={(event) => handleDelete(meeting.id, event)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></svg>
                    </button>}
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
