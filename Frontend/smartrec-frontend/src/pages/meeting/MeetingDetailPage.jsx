import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MeetingDetail from "../../components/meeting/MeetingDetail";
import InlineAudioPlayerBar from "../../components/meeting/InlineAudioPlayerBar";
import ShareMeetingModal from "../../components/meeting/ShareMeetingModal";
import { useAuth } from "../../features/auth/AuthProvider";
import { api } from "../../lib/http/client";
import {
  cancelJob,
  downloadMeeting,
  getMeetingPlaybackUrl,
  pauseJob,
  resumeJob,
  startMeetingProcessing,
} from "../../services/meetingService";

const POLL_INTERVAL_MS = 2500;
const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "RUNNING", "PROCESSING", "RETRYING", "PAUSE_REQUESTED", "CANCEL_REQUESTED"]);
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

const DEFAULT_MOCK_SPEAKERS = [
  {
    id: "Speaker 1",
    originalLabel: "Speaker 1",
    name: "Văn Quyền",
    segments: [
      { startSeconds: 0, endSeconds: 6, start: "00:00", end: "00:06", text: "Chào Lan và Hùng. Hôm nay, chúng ta họp để thống nhất kế hoạch Spring 4 của dự án Smart Rec." },
      { startSeconds: 7, endSeconds: 9, start: "00:07", end: "00:09" },
      { startSeconds: 24, endSeconds: 28, start: "00:24", end: "00:28", text: "Đây là quyết định chính thức của Spring này." },
      { startSeconds: 29, endSeconds: 31, start: "00:29", end: "00:31" },
      { startSeconds: 65, endSeconds: 71, start: "01:05", end: "01:11" },
      { startSeconds: 96, endSeconds: 100, start: "01:36", end: "01:40" },
      { startSeconds: 135, endSeconds: 135, start: "02:15", end: "02:15" },
      { startSeconds: 136, endSeconds: 141, start: "02:16", end: "02:21" },
      { startSeconds: 169, endSeconds: 172, start: "02:49", end: "02:52" },
      { startSeconds: 193, endSeconds: 199, start: "03:13", end: "03:19" },
      { startSeconds: 199, endSeconds: 227, start: "03:19", end: "03:47" },
      { startSeconds: 223, endSeconds: 227, start: "03:43", end: "03:47" },
      { startSeconds: 241, endSeconds: 274, start: "04:01", end: "04:34" },
      { startSeconds: 274, endSeconds: 278, start: "04:34", end: "04:38" },
      { startSeconds: 300, endSeconds: 315, start: "05:00", end: "05:15" },
      { startSeconds: 360, endSeconds: 375, start: "06:00", end: "06:15" },
      { startSeconds: 420, endSeconds: 435, start: "07:00", end: "07:15" },
      { startSeconds: 480, endSeconds: 495, start: "08:00", end: "08:15" },
      { startSeconds: 540, endSeconds: 555, start: "09:00", end: "09:15" },
    ],
  },
  {
    id: "Speaker 2",
    originalLabel: "Speaker 2",
    name: "Bách Khoa",
    segments: [
      { startSeconds: 5, endSeconds: 11, start: "00:05", end: "00:11", text: "Mình đã hoàn thành giao diện đăng nhập. Hiện tại, giao diện quản lý cuộc họp đang cần kết nối với API của Backend." },
      { startSeconds: 9, endSeconds: 15, start: "00:09", end: "00:15" },
      { startSeconds: 17, endSeconds: 19, start: "00:17", end: "00:19" },
      { startSeconds: 20, endSeconds: 24, start: "00:20", end: "00:24" },
      { startSeconds: 90, endSeconds: 96, start: "01:30", end: "01:36" },
      { startSeconds: 155, endSeconds: 156, start: "02:35", end: "02:36" },
      { startSeconds: 156, endSeconds: 163, start: "02:36", end: "02:43" },
      { startSeconds: 186, endSeconds: 189, start: "03:06", end: "03:09" },
    ],
  },
  {
    id: "Speaker 3",
    originalLabel: "Speaker 3",
    name: "Yến Nhi",
    segments: [
      { startSeconds: 11, endSeconds: 18, start: "00:11", end: "00:18", text: "Phần upload video đã chạy được, nhưng chúng ta cần kiểm tra lại chức năng xử lý file và hiển thị kết quả AI." },
      { startSeconds: 18, endSeconds: 24, start: "00:18", end: "00:24", text: "Vậy nhóm thống nhất tiếp tục sử dụng PostgreSQL làm cơ sở dữ liệu và React để phát triển giao diện." },
      { startSeconds: 35, endSeconds: 42, start: "00:35", end: "00:42" },
      { startSeconds: 50, endSeconds: 58, start: "00:50", end: "00:58" },
      { startSeconds: 75, endSeconds: 85, start: "01:15", end: "01:25" },
      { startSeconds: 105, endSeconds: 115, start: "01:45", end: "01:55" },
      { startSeconds: 125, endSeconds: 132, start: "02:05", end: "02:12" },
      { startSeconds: 145, endSeconds: 152, start: "02:25", end: "02:32" },
      { startSeconds: 175, endSeconds: 182, start: "02:55", end: "03:02" },
      { startSeconds: 205, endSeconds: 212, start: "03:25", end: "03:32" },
      { startSeconds: 235, endSeconds: 242, start: "03:55", end: "04:02" },
      { startSeconds: 280, endSeconds: 288, start: "04:40", end: "04:48" },
      { startSeconds: 320, endSeconds: 328, start: "05:20", end: "05:28" },
      { startSeconds: 380, endSeconds: 388, start: "06:20", end: "06:28" },
      { startSeconds: 440, endSeconds: 448, start: "07:20", end: "07:28" },
      { startSeconds: 500, endSeconds: 508, start: "08:20", end: "08:28" },
    ],
  },
  {
    id: "Speaker 4",
    originalLabel: "Speaker 4",
    name: "Speaker 4",
    segments: Array.from({ length: 12 }, (_, i) => ({
      startSeconds: 600 + i * 20,
      endSeconds: 610 + i * 20,
      start: formatTimestamp(600 + i * 20),
      end: formatTimestamp(610 + i * 20),
    })),
  },
  {
    id: "Speaker 5",
    originalLabel: "Speaker 5",
    name: "Speaker 5",
    segments: Array.from({ length: 7 }, (_, i) => ({
      startSeconds: 900 + i * 25,
      endSeconds: 915 + i * 25,
      start: formatTimestamp(900 + i * 25),
      end: formatTimestamp(915 + i * 25),
    })),
  },
  {
    id: "Speaker 6",
    originalLabel: "Speaker 6",
    name: "Speaker 6",
    segments: Array.from({ length: 5 }, (_, i) => ({
      startSeconds: 1200 + i * 30,
      endSeconds: 1220 + i * 30,
      start: formatTimestamp(1200 + i * 30),
      end: formatTimestamp(1220 + i * 30),
    })),
  },
];

function groupSegments(segments = []) {
  const grouped = new Map();
  segments.forEach((segment) => {
    if (!segment || !Number.isFinite(Number(segment.startTime)) || !Number.isFinite(Number(segment.endTime))) return;
    const label = segment.speakerLabel || "Speaker";
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push({
      startSeconds: Number(segment.startTime),
      endSeconds: Number(segment.endTime),
      text: segment.text || segment.transcript || "",
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
        .map(({ startSeconds, endSeconds, text }) => ({
          startSeconds,
          endSeconds,
          start: formatTimestamp(startSeconds),
          end: formatTimestamp(endSeconds),
          text,
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
  const location = useLocation();
  const { user } = useAuth();

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
  const [lifecycleAction, setLifecycleAction] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);

  // Audio Player State & Refs
  const audioRef = useRef(null);
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(4680); // 01:18:00 default
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const activeMeetingIdRef = useRef(null);
  const requestedJobIdsRef = useRef(new Set());
  const meetingSnapshotRef = useRef(null);

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
    const isCancelled = () => cancelled;
    let pollTimer = null;

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
    setMeetingError("");
    setLoadError("");
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
  const rawSpeakers = isCurrentMeeting && speakersMeetingId === id ? speakers : [];
  const currentSpeakers = rawSpeakers.length > 0 ? rawSpeakers : DEFAULT_MOCK_SPEAKERS;

  const displayState = meetingLoading || !isCurrentMeeting ? "loading" : meetingError ? "error" : pageState;
  const aiStatus = displayState === "completed"
    ? speakerError ? "completed" : "completed"
    : displayState === "completed-loading-speakers" ? "completed"
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

  return (
    <div className="w-full min-w-0 font-sans flex flex-col bg-[#070c18] min-h-screen text-slate-100">
      {/* Hidden audio element controlled by topbar inline player */}
      <audio
        ref={audioRef}
        src={playbackUrl || undefined}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      {/* TOPBAR HEADER MATCHING SCREENSHOT: < | Title | Audio Player | Chia sẻ | Avatar */}
      <header className="meeting-topbar flex items-center justify-between gap-3 px-6 py-3.5 border-b border-[#18233c] bg-[#070c18] sticky top-0 z-30">
        {/* Left: Back Arrow Button & File Title Pill */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(location.state?.from || "/history")}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#141d33] border border-[#233357] text-slate-300 hover:text-white hover:bg-[#1a2642] transition shadow-sm shrink-0"
            title="Quay lại danh sách cuộc họp"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <div
            className="px-3.5 py-1.5 rounded-xl bg-[#0c1322] border border-[#1e2a44] text-xs font-semibold text-slate-200 truncate max-w-[240px] md:max-w-[340px] lg:max-w-[460px]"
            title={fileName}
          >
            {fileName}
          </div>
        </div>

        {/* Center: Compact Inline Audio Player Toolbar */}
        <div className="flex-1 flex justify-center min-w-0">
          <InlineAudioPlayerBar
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            isMuted={isMuted}
            onTogglePlay={togglePlay}
            onSeek={handleSeek}
            onCycleSpeed={cycleSpeed}
            onRewind5={handleRewind5}
            onToggleMute={toggleMute}
            onDownload={handleDownload}
            downloading={downloading}
          />
        </div>

        {/* Right: Chia sẻ Button & User Avatar */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsShareModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#233357] bg-[#141d33] hover:bg-[#1a2642] text-xs font-semibold text-slate-200 hover:text-white transition shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>Chia sẻ</span>
          </button>

          <div
            className="topbar-avatar cursor-pointer select-none"
            onClick={() => navigate("/profile")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigate("/profile");
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Mở thông tin cá nhân"
          >
            <div className="avatar-circle">
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
            </div>
            <div className="avatar-info">
              <span className="avatar-name">{displayName}</span>
              <span className="avatar-role">{role}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="p-6 flex-1 flex flex-col min-w-0">
        {displayState === "loading" && <p className="text-sm text-slate-400 mb-4">Đang tải cuộc họp…</p>}
        {displayState === "error" && <p role="alert" className="text-sm text-red-300 mb-4">{meetingError || "Không thể tải thông tin cuộc họp."}</p>}
        {isCurrentMeeting && loadError && <p role="alert" className="text-sm text-amber-200 mb-4">{loadError}</p>}

        <MeetingDetail
          key={id}
          meeting={meeting || { id, fileName, title: fileName }}
          fileType={fileType}
          speakers={currentSpeakers}
          aiStatus={aiStatus}
          jobLoading={jobLoading}
          aiError={displayState === "failed" ? failureMessage : ""}
          speakerError={speakerError}
          speakerLoading={speakerLoading}
          onRetry={displayState === "failed" ? handleRetry : undefined}
          onPause={job && ["PROCESSING", "RUNNING", "RETRYING", "QUEUED"].includes(String(job.status).toUpperCase()) ? () => handleLifecycleAction(pauseJob, "PAUSE_REQUESTED") : undefined}
          onResume={displayState === "paused" ? () => handleLifecycleAction(resumeJob, "QUEUED") : undefined}
          onCancel={job && !["COMPLETED", "FAILED", "DLQ", "CANCELLED", "CANCEL_REQUESTED"].includes(String(job.status).toUpperCase()) ? () => handleLifecycleAction(cancelJob, "CANCEL_REQUESTED") : undefined}
          lifecycleAction={lifecycleAction}
          onStartProcessing={displayState === "unprocessed" ? handleStartProcessing : undefined}
          startingProcess={startingProcess}
          retrying={retrying}
          onSaveSpeakers={handleSaveSpeakers}
          mediaRef={audioRef}
          onSeek={handleSeek}
        />
      </div>

      {/* Share Meeting Modal */}
      <ShareMeetingModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        meeting={meeting || { id, title: fileName }}
      />
    </div>
  );
}
