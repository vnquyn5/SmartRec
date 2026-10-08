import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MeetingDetail from "../../components/meeting/MeetingDetail";
import { api } from "../../lib/http/client";
import { startMeetingProcessing } from "../../services/meetingService";

const POLL_INTERVAL_MS = 2500;
const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "RUNNING", "PROCESSING", "RETRYING"]);
const FAILURE_STATUSES = new Set(["FAILED", "DLQ", "CANCELLED"]);
const COMPLETE_STATUSES = new Set(["COMPLETED", "SUCCESS", "SUCCEEDED"]);
const UNPROCESSED_STATUS = "UNPROCESSED";

function formatTimestamp(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function groupSegments(segments = []) {
  const grouped = new Map();
  segments.forEach((segment) => {
    if (!segment || !Number.isFinite(Number(segment.startTime)) || !Number.isFinite(Number(segment.endTime))) return;
    const label = segment.speakerLabel || "Speaker";
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push({
      startSeconds: Number(segment.startTime),
      endSeconds: Number(segment.endTime),
    });
  });
  return [...grouped.entries()]
    .sort(([labelA], [labelB]) => labelA.localeCompare(labelB, undefined, { numeric: true }))
    .map(([label, times]) => ({
      id: label,
      originalLabel: label,
      name: label,
      segments: times
        .sort((a, b) => a.startSeconds - b.startSeconds)
        .map(({ startSeconds, endSeconds }) => ({
          startSeconds,
          endSeconds,
          start: formatTimestamp(startSeconds),
          end: formatTimestamp(endSeconds),
        })),
    }));
}

function apiMessage(error, fallback) {
  const message = error?.response?.data?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [meetingId, setMeetingId] = useState(null);
  const [meetingLoading, setMeetingLoading] = useState(true);
  const [meetingError, setMeetingError] = useState("");
  const [job, setJob] = useState(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [speakers, setSpeakers] = useState([]);
  const [speakersMeetingId, setSpeakersMeetingId] = useState(null);
  const [speakerLoading, setSpeakerLoading] = useState(false);
  const [pageState, setPageState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [speakerError, setSpeakerError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [startingProcess, setStartingProcess] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const activeMeetingIdRef = useRef(null);
  const requestedJobIdsRef = useRef(new Set());

  const refresh = useCallback(async (isCancelled) => {
    const currentMeeting = await api.get(`/meetings/${id}`);
    if (isCancelled()) return { shouldPoll: false };
    if (!currentMeeting || currentMeeting.id !== id) {
      throw new Error("API không trả về đúng thông tin cuộc họp.");
    }
    setMeeting(currentMeeting);
    setMeetingId(id);
    setMeetingLoading(false);
    setMeetingError("");
    const initialMeetingStatus = String(currentMeeting.status || "").toUpperCase();
    if (initialMeetingStatus === UNPROCESSED_STATUS) {
      setJob(null);
      setJobLoading(false);
      setSpeakers([]);
      setSpeakersMeetingId(null);
      setSpeakerLoading(false);
      setSpeakerError("");
      setLoadError("");
      setPageState("unprocessed");
      return { shouldPoll: false };
    }
    if (FAILURE_STATUSES.has(initialMeetingStatus)) {
      setPageState("failed");
    } else if (COMPLETE_STATUSES.has(initialMeetingStatus)) {
      setPageState("completed-loading-speakers");
      setSpeakerLoading(true);
    } else if (ACTIVE_STATUSES.has(initialMeetingStatus)) {
      setPageState(initialMeetingStatus === "PENDING" || initialMeetingStatus === "QUEUED" ? "queued" : "processing");
    }

    let currentJob = null;
    let jobLoadError = "";
    if (currentMeeting.activeJobId) {
      const isFirstJobRequest = !requestedJobIdsRef.current.has(currentMeeting.activeJobId);
      if (isFirstJobRequest) setJobLoading(true);
      try {
        currentJob = await api.get(`/jobs/${currentMeeting.activeJobId}`);
        if (isCancelled()) return { shouldPoll: false };
        requestedJobIdsRef.current.add(currentMeeting.activeJobId);
      } catch (error) {
        requestedJobIdsRef.current.add(currentMeeting.activeJobId);
        // If meeting itself is terminal, its state still provides a definitive result.
        if (!COMPLETE_STATUSES.has(String(currentMeeting.status || "").toUpperCase()) &&
            !FAILURE_STATUSES.has(String(currentMeeting.status || "").toUpperCase())) {
          jobLoadError = apiMessage(error, "Không thể tải trạng thái Audio AI.");
        }
      }
    }
    setJob(currentJob);
    setJobLoading(false);
    setLoadError(jobLoadError);

    const meetingStatus = String(currentMeeting.status || "").toUpperCase();
    const jobStatus = String(currentJob?.status || "").toUpperCase();
    const status = jobStatus || meetingStatus;

    if (FAILURE_STATUSES.has(status) || FAILURE_STATUSES.has(meetingStatus)) {
      setSpeakers([]);
      setSpeakersMeetingId(id);
      setSpeakerError("");
      setPageState("failed");
      return { shouldPoll: false };
    }

    if (COMPLETE_STATUSES.has(status) || COMPLETE_STATUSES.has(meetingStatus)) {
      setPageState("completed-loading-speakers");
      setSpeakerLoading(true);
      try {
        const speakerResponse = await api.get(`/meetings/${id}/speakers`);
        if (isCancelled()) return { shouldPoll: false };
        setSpeakers(groupSegments(Array.isArray(speakerResponse) ? speakerResponse : []));
        setSpeakersMeetingId(id);
        setSpeakerError("");
        setPageState("completed");
      } catch (error) {
        if (isCancelled()) return { shouldPoll: false };
        setSpeakers([]);
        setSpeakersMeetingId(id);
        setSpeakerError(apiMessage(error, "Không thể tải kết quả người nói."));
        setPageState("completed");
      } finally {
        if (!isCancelled()) setSpeakerLoading(false);
      }
      return { shouldPoll: false };
    }

    setSpeakers([]);
    setSpeakersMeetingId(null);
    setSpeakerError("");
    if (ACTIVE_STATUSES.has(status) || ACTIVE_STATUSES.has(meetingStatus)) {
      setPageState(status === "PENDING" || status === "QUEUED" ? "queued" : "processing");
      return { shouldPoll: true };
    }
    throw new Error(`Trạng thái cuộc họp không được hỗ trợ: ${status || "không xác định"}`);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const isNewMeeting = activeMeetingIdRef.current !== id;
    activeMeetingIdRef.current = id;
    if (isNewMeeting) {
      setMeeting(null);
      setMeetingId(null);
      setMeetingLoading(true);
      setMeetingError("");
      setJob(null);
      setJobLoading(false);
      setSpeakers([]);
      setSpeakersMeetingId(null);
      setSpeakerLoading(false);
      setPageState("loading");
      setLoadError("");
      setSpeakerError("");
      requestedJobIdsRef.current.clear();
    }

    const poll = async () => {
      try {
        const result = await refresh(() => cancelled);
        if (!cancelled && result.shouldPoll) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        setMeetingLoading(false);
        setMeetingError(apiMessage(error, error?.message || "Không thể tải thông tin cuộc họp."));
        setPageState("error");
        setJobLoading(false);
        setSpeakerLoading(false);
      }
    };
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, refreshGeneration, refresh]);

  const handleRetry = async () => {
    if (!job?.id || retrying) return;
    setRetrying(true);
    setSpeakers([]);
    setSpeakersMeetingId(null);
    setPageState("processing");
    try {
      await api.post(`/jobs/${job.id}/retry`);
      setJob((current) => current ? { ...current, status: "RETRYING", errorMessage: null } : current);
      setLoadError("");
      setRefreshGeneration((generation) => generation + 1);
    } catch (error) {
      setPageState("failed");
      setLoadError(apiMessage(error, "Không thể gửi yêu cầu thử lại."));
    } finally {
      setRetrying(false);
    }
  };

  const handleStartProcessing = async () => {
    if (!id || startingProcess) return;
    setStartingProcess(true);
    setLoadError("");
    try {
      const createdJob = await startMeetingProcessing(id);
      setJob(createdJob);
      setPageState("queued");
      setRefreshGeneration((generation) => generation + 1);
    } catch (error) {
      setLoadError(apiMessage(error, "Không thể bắt đầu xử lý cuộc họp."));
    } finally {
      setStartingProcess(false);
    }
  };

  const handleSaveSpeakers = async (updatedSpeakers) => {
    if (speakersMeetingId !== id) throw new Error("Dữ liệu người nói không thuộc cuộc họp hiện tại.");
    for (const speaker of updatedSpeakers) {
      const nextName = speaker.name?.trim();
      if (nextName && nextName !== speaker.originalLabel) {
        await api.put(`/meetings/${id}/speakers/rename`, {
          speakerLabel: speaker.originalLabel,
          newName: nextName,
        });
      }
    }
    const response = await api.get(`/meetings/${id}/speakers`);
    setSpeakers(groupSegments(Array.isArray(response) ? response : []));
    setSpeakersMeetingId(id);
  };

  const isCurrentMeeting = meetingId === id && meeting?.id === id;
  const currentSpeakers = isCurrentMeeting && speakersMeetingId === id ? speakers : [];
  const displayState = meetingLoading || !isCurrentMeeting ? "loading" : meetingError ? "error" : pageState;
  const aiStatus = displayState === "completed"
    ? speakerError ? "completed" : currentSpeakers.length === 0 ? "empty" : "completed"
    : displayState === "completed-loading-speakers" ? "completed"
    : displayState === "failed" ? "failed"
      : displayState === "error" ? "error"
        : displayState === "unprocessed" ? "unprocessed"
          : displayState === "queued" ? "queued" : "processing";
  const fileName = isCurrentMeeting ? (meeting.fileName || meeting.title || "Cuộc họp") : "Cuộc họp";
  const fileType = isCurrentMeeting && (meeting.mimeType?.startsWith("audio/") || /\.(mp3|wav|m4a|flac|ogg)$/i.test(meeting.fileName || "")) ? "audio" : "video";
  const failureMessage = job?.errorMessage && !/(?:\n|\r|Traceback|Exception:|Error:|\bat\s+[\w.$]+\()/i.test(job.errorMessage)
    ? job.errorMessage
    : `Xử lý âm thanh thất bại${job?.errorCode ? ` (${job.errorCode})` : ""}.`;

  return (
    <div className="w-full min-w-0 font-sans flex flex-col">
      <div className="flex items-center justify-between mb-5 pb-3 border-b border-[#1b2742] min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={() => navigate("/workspace")} className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#141d33] border border-[#233357] text-slate-300 hover:text-white hover:bg-[#1a2642] transition shadow-sm shrink-0" title="Quay lại">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h1 className="text-base font-bold text-white tracking-wide truncate" title={fileName}>{fileName}</h1>
        </div>
      </div>
      {displayState === "loading" && <p className="text-sm text-slate-400 mb-4">Đang tải cuộc họp…</p>}
      {displayState === "error" && <p role="alert" className="text-sm text-red-300 mb-4">{meetingError || "Không thể tải thông tin cuộc họp."}</p>}
      {isCurrentMeeting && loadError && <p role="alert" className="text-sm text-amber-200 mb-4">{loadError}</p>}
      {isCurrentMeeting && displayState !== "loading" && <MeetingDetail
        key={id}
        meeting={meeting}
        fileType={fileType}
        speakers={currentSpeakers}
        aiStatus={aiStatus}
        jobLoading={jobLoading}
        aiError={displayState === "failed" ? failureMessage : ""}
        speakerError={speakerError}
        speakerLoading={speakerLoading}
        onRetry={displayState === "failed" ? handleRetry : undefined}
        onStartProcessing={displayState === "unprocessed" ? handleStartProcessing : undefined}
        startingProcess={startingProcess}
        retrying={retrying}
        onSaveSpeakers={displayState === "completed" && !speakerError ? handleSaveSpeakers : undefined}
      />}
    </div>
  );
}
