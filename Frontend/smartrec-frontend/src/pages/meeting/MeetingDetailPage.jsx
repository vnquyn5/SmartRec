import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MeetingDetail from "../../components/meeting/MeetingDetail";
import MeetingVideoPlayer from "../../components/meeting/MeetingVideoPlayer";
import ShareMeetingModal from "../../components/meeting/ShareMeetingModal";
import ExportModal from "../../components/exporter/ExportModal";
import { useAuth } from "../../features/auth/AuthProvider";
import { usePageHeader } from "../../components/layout/PageHeaderContext.jsx";
import { api } from "../../lib/http/client";
import { cancelJob, pauseJob, resumeJob, startMeetingProcessing } from "../../services/meetingService";
import { mapSpeakerManagementSegments } from "../../components/meeting/transcriptData";
import { mapMeetingResults } from "../../components/meeting/meetingResults";

const POLL_INTERVAL_MS = 2500;
const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "RUNNING", "PROCESSING", "RETRYING", "PAUSE_REQUESTED", "CANCEL_REQUESTED"]);
const FAILURE_STATUSES = new Set(["FAILED", "DLQ", "CANCELLED"]);
const COMPLETE_STATUSES = new Set(["COMPLETED", "SUCCESS", "SUCCEEDED"]);
const UNPROCESSED_STATUS = "UNPROCESSED";

function groupSegments(segments = []) {
  return mapSpeakerManagementSegments(segments);
}

function apiMessage(error, fallback) {
  const message = error?.response?.data?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { setPageHeader } = usePageHeader();
  const { user } = useAuth();
  const mediaRef = useRef(null);
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
  const [results, setResults] = useState(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [startingProcess, setStartingProcess] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const [shareMeeting, setShareMeeting] = useState(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const activeMeetingIdRef = useRef(null);
  const requestedJobIdsRef = useRef(new Set());
  const meetingSnapshotRef = useRef(null);
  const resultsSnapshotRef = useRef(null);

  useEffect(() => {
    setShareMeeting(null);
  }, [id]);

  const displayName = user?.name || "Quyền Văn";
  const role = user?.role || "User";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "QV";

  // Fetch Playback URL
  useEffect(() => {
    let isCancelled = false;
    if (!id) return;
    getMeetingPlaybackUrl(id)
      .then((res) => {
        if (!isCancelled && res?.url) {
          setPlaybackUrl(res.url);
        }
      })
      .catch(() => {
        // Fallback for demo/offline
      });
    return () => {
      isCancelled = true;
    };
  }, [id]);

  const refresh = useCallback(async (isCancelled, { fetchMeeting = true } = {}) => {
    const currentMeeting = fetchMeeting || !meetingSnapshotRef.current
      ? await api.get(`/meetings/${id}`)
      : meetingSnapshotRef.current;
    if (isCancelled()) return { shouldPoll: false };
    if (!currentMeeting || currentMeeting.id !== id) {
      throw new Error("API không trả về đúng thông tin cuộc họp.");
    }
    meetingSnapshotRef.current = currentMeeting;
    setMeeting(currentMeeting);
    setMeetingId(id);
    setMeetingLoading(false);
    setMeetingError("");
    if (currentMeeting.durationSeconds) {
      setDuration(currentMeeting.durationSeconds);
    }
    const initialMeetingStatus = String(currentMeeting.status || "").toUpperCase();
    if (initialMeetingStatus === UNPROCESSED_STATUS) {
      setJob(null);
      setJobLoading(false);
      setSpeakers([]);
      setSpeakersMeetingId(null);
      setSpeakerLoading(false);
      setSpeakerError("");
      resultsSnapshotRef.current = null;
      setResults(null);
      setResultsLoading(false);
      setResultsError("");
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

    const resultsJobId = currentJob?.id || currentMeeting.activeJobId;
    if (!resultsJobId) {
      resultsSnapshotRef.current = null;
      setResults(null);
      setResultsError("");
      setResultsLoading(false);
    } else {
      const hasCurrentResults = resultsSnapshotRef.current?.jobId === resultsJobId;
      setResultsLoading(!hasCurrentResults);
      try {
        const resultPayload = await api.get(`/meetings/${id}/jobs/${resultsJobId}/results`);
        if (isCancelled()) return { shouldPoll: false };
        if (resultPayload?.meetingId !== id || resultPayload?.jobId !== resultsJobId) {
          throw new Error("API trả kết quả không thuộc cuộc họp hoặc Job hiện tại.");
        }
        const mappedResults = mapMeetingResults(resultPayload);
        resultsSnapshotRef.current = mappedResults;
        setResults(mappedResults);
        setResultsError("");
      } catch (error) {
        if (isCancelled()) return { shouldPoll: false };
        resultsSnapshotRef.current = null;
        setResults(null);
        setResultsError(apiMessage(error, "Không thể tải kết quả AI của cuộc họp."));
      } finally {
        if (!isCancelled()) setResultsLoading(false);
      }
    }

    if (FAILURE_STATUSES.has(status) || (!jobStatus && FAILURE_STATUSES.has(meetingStatus))) {
      setSpeakers([]);
      setSpeakersMeetingId(id);
      setSpeakerError("");
      setPageState("failed");
      return { shouldPoll: false };
    }

    if (COMPLETE_STATUSES.has(status) || (!jobStatus && COMPLETE_STATUSES.has(meetingStatus))) {
      setPageState("completed-loading-speakers");
      setSpeakerLoading(true);
      try {
        const response = await api.get(`/meetings/${id}/speakers`);
        if (isCancelled()) return { shouldPoll: false };
        setSpeakers(groupSegments(Array.isArray(response) ? response : []));
        setSpeakersMeetingId(id);
        setSpeakerError("");
      } catch (error) {
        if (isCancelled()) return { shouldPoll: false };
        setSpeakers([]);
        setSpeakersMeetingId(id);
        setSpeakerError(apiMessage(error, "Không thể tải danh sách người nói."));
      } finally {
        if (!isCancelled()) {
          setSpeakerLoading(false);
          setPageState("completed");
        }
      }
      return { shouldPoll: false };
    }

    if (["PAUSED", "PAUSE_REQUESTED", "CANCEL_REQUESTED"].includes(status)) {
      setPageState(status.toLowerCase().replace("_", "-"));
      return { shouldPoll: true };
    }

    return { shouldPoll: ACTIVE_STATUSES.has(status) };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const isNewMeeting = activeMeetingIdRef.current !== id;
    activeMeetingIdRef.current = id;
    if (isNewMeeting) {
      meetingSnapshotRef.current = null;
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
      resultsSnapshotRef.current = null;
      setResults(null);
      setResultsLoading(false);
      setResultsError("");
      requestedJobIdsRef.current.clear();
    }

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
    setRetrying(false);
    setStartingProcess(false);
    setLifecycleAction(false);
    activeMeetingIdRef.current = id;
    meetingSnapshotRef.current = null;
    requestedJobIdsRef.current.clear();

    const run = async () => {
      try {
        const { shouldPoll } = await refresh(isCancelled, { fetchMeeting: true });
        if (cancelled || !shouldPoll) return;
        const scheduleNext = () => {
          pollTimer = setTimeout(async () => {
            if (cancelled) return;
            try {
              const result = await refresh(isCancelled, { fetchMeeting: true });
              if (!cancelled && result.shouldPoll) scheduleNext();
            } catch {
              if (!cancelled) scheduleNext();
            }
          }, POLL_INTERVAL_MS);
        };
        scheduleNext();
      } catch (error) {
        if (cancelled) return;
        setMeetingLoading(false);
        setMeetingError(apiMessage(error, "Không thể tải thông tin cuộc họp."));
        setPageState("error");
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [id, refresh, refreshGeneration]);

  // Audio Playback Handlers
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current && Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0) {
      setDuration(audioRef.current.duration);
    } else if (meeting?.durationSeconds) {
      setDuration(meeting.durationSeconds);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {
        setIsPlaying(true);
      });
    }
  };

  const handleSeek = (seconds) => {
    const sec = Math.max(0, Math.min(seconds, duration || 4680));
    setCurrentTime(sec);
    if (audioRef.current) {
      audioRef.current.currentTime = sec;
      if (!isPlaying) {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(true));
      }
    }
  };

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2, 0.75];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackRate(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const handleRewind5 = () => {
    handleSeek(Math.max(0, currentTime - 5));
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) {
      audioRef.current.muted = nextMuted;
    }
  };

  const handleDownload = async () => {
    if (!id || downloading) return;
    setDownloading(true);
    try {
      const blob = await downloadMeeting(id);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName || "meeting-file";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch {
      // safe fallback
    } finally {
      setDownloading(false);
    }
  };

  const handleRetry = async () => {
    if (!id || retrying) return;
    setRetrying(true);
    setSpeakers([]);
    setSpeakersMeetingId(null);
    resultsSnapshotRef.current = null;
    setResults(null);
    setResultsLoading(false);
    setResultsError("");
    setPageState("processing");
    try {
      await api.post(`/meetings/${id}/retry`);
      setRefreshGeneration((value) => value + 1);
    } catch (error) {
      setLoadError(apiMessage(error, "Không thể thử lại xử lý Audio AI."));
    } finally {
      setRetrying(false);
    }
  };

  const handleStartProcessing = async () => {
    if (!id || startingProcess) return;
    setStartingProcess(true);
    setMeetingError("");
    setLoadError("");
    try {
      await startMeetingProcessing(id);
      setRefreshGeneration((value) => value + 1);
    } catch (error) {
      setLoadError(apiMessage(error, "Không thể bắt đầu xử lý Audio AI."));
    } finally {
      setStartingProcess(false);
    }
  };

  const handleLifecycleAction = async (action, optimisticStatus) => {
    if (!job?.id || lifecycleAction) return;
    setLifecycleAction(true);
    setLoadError("");
    try {
      await action(job.id);
      setJob((current) => (current ? { ...current, status: optimisticStatus } : current));
      setPageState(optimisticStatus.toLowerCase().replace("_", "-"));
    } catch (error) {
      setLoadError(apiMessage(error, "Không thể cập nhật trạng thái Audio AI."));
    } finally {
      setLifecycleAction(false);
    }
  };

  const handleSaveSpeakers = async (updatedSpeakers) => {
    if (speakersMeetingId !== id) throw new Error("Dữ liệu người nói không thuộc cuộc họp hiện tại.");
    const refreshSpeakerAndResultData = async () => {
      const [speakerResponse, resultPayload] = await Promise.all([
        api.get(`/meetings/${id}/speakers`),
        job?.id ? api.get(`/meetings/${id}/jobs/${job.id}/results`) : Promise.resolve(null),
      ]);
      const nextSpeakers = groupSegments(Array.isArray(speakerResponse) ? speakerResponse : []);
      setSpeakers(nextSpeakers);
      setSpeakersMeetingId(id);
      if (resultPayload?.meetingId === id && resultPayload?.jobId === job.id) {
        const mappedResults = mapMeetingResults(resultPayload);
        resultsSnapshotRef.current = mappedResults;
        setResults(mappedResults);
      }
    };
    try {
      for (const speaker of updatedSpeakers) {
        const nextName = speaker.name?.trim();
        const currentName = speaker.currentName || speaker.nameAtLoad || '';
        if (nextName && nextName !== currentName) {
          await api.put(`/meetings/${id}/speakers/rename`, {
            speakerId: speaker.speakerId || speaker.id,
            speakerLabel: speaker.originalLabel,
            newName: nextName,
          });
        }
      }
      await refreshSpeakerAndResultData();
    } catch (error) {
      // If a multi-speaker save partially reached the server, refresh from server
      // truth before showing the failure; never present an optimistic success.
      await refreshSpeakerAndResultData().catch(() => {});
      throw error;
    }
  };

  const isCurrentMeeting = meetingId === id && meeting?.id === id;
  const rawSpeakers = isCurrentMeeting && speakersMeetingId === id ? speakers : [];
  const currentSpeakers = rawSpeakers;

  const displayState = meetingLoading || !isCurrentMeeting ? "loading" : meetingError ? "error" : pageState;
  const currentLlmStatus = results?.jobId === job?.id ? results?.llmStatus : null;
  const enrichmentStatus = currentLlmStatus === "FAILED" || job?.errorCode === "AI_ENRICHMENT_FAILED"
    ? "enrichment_failed"
    : currentLlmStatus === "DISABLED" || job?.errorCode === "AI_ENRICHMENT_DISABLED"
      ? "enrichment_disabled" : null;
  const aiStatus = displayState === "completed"
    ? enrichmentStatus || (speakerError ? "completed" : currentSpeakers.length === 0 ? "empty" : "completed")
    : displayState === "completed-loading-speakers" ? enrichmentStatus || "completed"
      : displayState === "failed" ? "failed"
      : displayState === "paused" ? "paused"
      : displayState === "pause-requested" ? "pause-requested"
      : displayState === "cancel-requested" ? "cancel-requested"
      : displayState === "error" ? "error"
        : displayState === "unprocessed" ? "unprocessed"
          : displayState === "queued" ? "queued" : "processing";

  const fileName = isCurrentMeeting
    ? (meeting.fileName || meeting.title || "ElevenLabs_2026-11-06T06_35_34_Tuan_Anh_-._Deep____Powerful_Vietnamese_pvc_s50_sim75_v4.mp3")
    : "ElevenLabs_2026-11-06T06_35_34_Tuan_Anh_-._Deep____Powerful_Vietnamese_pvc_s50_sim75_v4.mp3";

  const fileType = isCurrentMeeting && (meeting.mimeType?.startsWith("video/") || /\.(mp4|mkv|webm|mov)$/i.test(meeting.fileName || "")) ? "video" : "audio";

  const failureMessage = job?.errorMessage && !/(?:\n|\r|Traceback|Exception:|Error:|\bat\s+[\w.$]+\()/i.test(job.errorMessage)
    ? job.errorMessage
    : `Xử lý âm thanh thất bại${job?.errorCode ? ` (${job.errorCode})` : ""}.`;

  useEffect(() => {
    const subtitle = meetingError
      ? "Không thể tải thông tin cuộc họp."
      : !isCurrentMeeting || displayState === "loading"
        ? "Đang tải thông tin cuộc họp…"
        : "Transcript và phân tích AI của cuộc họp.";
    setPageHeader({
      title: isCurrentMeeting
        ? fileName
        : meetingError
          ? "Không thể tải cuộc họp"
          : "Đang tải cuộc họp…",
      subtitle,
    });
  }, [displayState, fileName, isCurrentMeeting, meetingError, setPageHeader]);

  return (
    <div className="meeting-details-page w-full min-w-0 min-h-0 font-sans flex flex-col">
      <div className="meeting-detail-toolbar mb-3 flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-[#1b2742] pb-3">
        <div className="meeting-detail-heading flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigate("/history")} className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#141d33] border border-[#233357] text-slate-300 hover:text-white hover:bg-[#1a2642] transition shadow-sm shrink-0" title="Quay lại danh sách cuộc họp">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        </div>
        <div className="meeting-detail-toolbar-actions flex min-w-0 items-center justify-end gap-2">
          {isCurrentMeeting && <MeetingVideoPlayer
            meetingId={meeting?.id}
            fileName={meeting?.fileName || meeting?.title}
            mimeType={meeting?.mimeType}
            fileType={fileType}
            mediaRef={mediaRef}
            durationSeconds={meeting?.durationSeconds}
          />}
          <button
            type="button"
            onClick={() => setIsExportModalOpen(true)}
            disabled={!isCurrentMeeting}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#243b6b] bg-[#13203d] px-3 text-xs font-semibold text-[#38bdf8] transition hover:bg-[#1a2b52] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Xuất tài liệu cuộc họp"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 18 15 15" />
            </svg>
            <span>Xuất tài liệu</span>
          </button>
          <button
            type="button"
            onClick={() => setShareMeeting(meeting)}
            disabled={!isCurrentMeeting}
            className="meeting-share-button flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#2a3b60] bg-[#141d33] px-3 text-xs font-semibold text-slate-200 transition hover:border-sky-400/60 hover:bg-[#1a2642] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Chia sẻ cuộc họp"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4" /></svg>
            <span>Chia sẻ</span>
          </button>
        </div>
      </div>
      {displayState === "loading" && <p role="status" className="text-sm text-slate-400 mb-4 shrink-0">Đang tải cuộc họp…</p>}
      {displayState === "error" && <p role="alert" className="text-sm text-red-300 mb-4 shrink-0">{meetingError || "Không thể tải thông tin cuộc họp."}</p>}
      {isCurrentMeeting && loadError && <p role="alert" className="text-sm text-amber-200 mb-4 shrink-0">{loadError}</p>}
      {isCurrentMeeting && displayState !== "loading" && <MeetingDetail
        key={id}
        meeting={meeting}
        mediaRef={mediaRef}
        job={job}
        jobId={job?.id || meeting?.activeJobId}
        jobStatus={job?.status || meeting?.status}
        fileType={fileType}
        speakers={currentSpeakers}
        aiStatus={aiStatus}
        jobLoading={jobLoading}
        aiError={displayState === "failed" ? failureMessage : ""}
        speakerError={speakerError}
        speakerLoading={speakerLoading}
        results={results}
        resultsLoading={resultsLoading}
        resultsError={resultsError}
        onRetry={displayState === "failed" ? handleRetry : undefined}
        onPause={job && ["PROCESSING", "RUNNING", "RETRYING", "QUEUED"].includes(String(job.status).toUpperCase()) ? () => handleLifecycleAction(pauseJob, "PAUSE_REQUESTED") : undefined}
        onResume={displayState === "paused" ? () => handleLifecycleAction(resumeJob, "QUEUED") : undefined}
        onCancel={job && !["COMPLETED", "FAILED", "DLQ", "CANCELLED", "CANCEL_REQUESTED"].includes(String(job.status).toUpperCase()) ? () => handleLifecycleAction(cancelJob, "CANCEL_REQUESTED") : undefined}
        lifecycleAction={lifecycleAction}
        onStartProcessing={displayState === "unprocessed" ? handleStartProcessing : undefined}
        startingProcess={startingProcess}
        retrying={retrying}
        onSaveSpeakers={displayState === "completed" && !speakerError ? handleSaveSpeakers : undefined}
      />}
      {shareMeeting && (
        <ShareMeetingModal
          meeting={shareMeeting}
          isOwner={shareMeeting?.isOwner !== false}
          onClose={() => setShareMeeting(null)}
        />
      )}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        meeting={meeting || { id, fileName, title: fileName }}
        speakers={currentSpeakers}
        defaultAuthorName={displayName}
      />
    </div>
  );
}
