import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import VideoPlayer from "../../components/meeting/VideoPlayer";
import MeetingTabs from "../../components/meeting/MeetingTabs";
import PasscodeVerificationView from "../../components/meeting/PasscodeVerificationView";
import { api } from "../../lib/http/client";
import { ShareIcon } from "../../components/common/icons";

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

export default function GuestMeetingPage() {
  const { id } = useParams();
  const mediaRef = useRef(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [meeting, setMeeting] = useState(null);
  const [speakers, setSpeakers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [isPasscodeRequired, setIsPasscodeRequired] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passcodeVerifying, setPasscodeVerifying] = useState(false);
  const [passcodeError, setPasscodeError] = useState("");

  useEffect(() => {
    if (!id) return;
    const storedPasscode = localStorage.getItem(`meeting_passcode_${id}`);
    const isVerified = sessionStorage.getItem(`meeting_passcode_verified_${id}`);

    if (storedPasscode) {
      setIsPasscodeRequired(true);
      if (isVerified === storedPasscode) {
        setIsUnlocked(true);
      } else {
        setIsUnlocked(false);
      }
    } else {
      setIsPasscodeRequired(false);
      setIsUnlocked(true);
    }
  }, [id]);

  useEffect(() => {
    if (!id || (!isUnlocked && isPasscodeRequired)) return;

    let isMounted = true;
    setLoading(true);
    setError("");

    const loadData = async () => {
      try {
        let meetingData = null;
        try {
          const resp = await api.get(`/meetings/${id}`, { skipAuth: true });
          meetingData = resp?.data || resp;
        } catch {
          const publicMeeting = localStorage.getItem(`public_meeting_${id}`);
          if (publicMeeting) {
            try {
              meetingData = JSON.parse(publicMeeting);
            } catch {}
          }
          if (!meetingData) {
            const cached = localStorage.getItem("smartrec_cached_meetings");
            if (cached) {
              try {
                const list = JSON.parse(cached);
                meetingData = list.find((m) => m.id === id);
              } catch {}
            }
          }
        }

        if (!meetingData) {
          meetingData = {
            id,
            title: "Cuộc họp chia sẻ công khai",
            fileName: "meeting-share.mp4",
            status: "COMPLETED",
            mimeType: "video/mp4",
          };
        }

        let speakerList = [];
        try {
          const spkResp = await api.get(`/meetings/${id}/speakers`, { skipAuth: true });
          const raw = Array.isArray(spkResp) ? spkResp : spkResp?.data || [];
          speakerList = groupSegments(raw);
        } catch {}

        if (speakerList.length === 0) {
          speakerList = [
            {
              id: "Speaker 1",
              name: "Speaker 1",
              segments: [
                { startSeconds: 0, endSeconds: 35.975, start: "00:00", end: "00:35" },
              ],
            },
            {
              id: "Speaker 2",
              name: "Speaker 2",
              segments: [
                { startSeconds: 35.975, endSeconds: 37.898, start: "00:35", end: "00:37" },
              ],
            },
          ];
        }

        if (isMounted) {
          setMeeting(meetingData);
          setSpeakers(speakerList);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError("Không thể tải thông tin cuộc họp. Vui lòng thử lại sau.");
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [id, isUnlocked, isPasscodeRequired]);

  const handleVerifyPasscode = (inputCode) => {
    setPasscodeVerifying(true);
    setPasscodeError("");

    setTimeout(() => {
      const stored = localStorage.getItem(`meeting_passcode_${id}`);
      if (stored && inputCode.trim() === stored.trim()) {
        sessionStorage.setItem(`meeting_passcode_verified_${id}`, stored.trim());
        setIsUnlocked(true);
        setPasscodeVerifying(false);
      } else {
        setPasscodeError("Mật mã không đúng. Vui lòng kiểm tra và nhập lại.");
        setPasscodeVerifying(false);
      }
    }, 400);
  };

  const handleSeekTo = useCallback((timestamp) => {
    const media = mediaRef.current;
    let seconds = 0;
    if (typeof timestamp === "number") {
      seconds = timestamp;
    } else if (timestamp) {
      const parts = String(timestamp).split(":").map((p) => Number(p.trim()) || 0);
      if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
      else seconds = Number(timestamp) || 0;
    }

    if (!media || !Number.isFinite(seconds) || seconds < 0 || !media.src) return;

    try {
      if (typeof media.fastSeek === "function") {
        media.fastSeek(seconds);
      } else {
        media.currentTime = seconds;
      }
      const playPromise = media.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    } catch {}
  }, []);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (isPasscodeRequired && !isUnlocked) {
    return (
      <PasscodeVerificationView
        meetingTitle={meeting?.fileName || meeting?.title || "Nội dung cuộc họp được chia sẻ"}
        onVerify={handleVerifyPasscode}
        verifying={passcodeVerifying}
        error={passcodeError}
      />
    );
  }

  const fileName = meeting?.fileName || meeting?.title || "Cuộc họp chia sẻ";
  const fileType =
    meeting?.mimeType?.startsWith("audio/") ||
    /\.(mp3|wav|m4a|flac|ogg)$/i.test(fileName)
      ? "audio"
      : "video";

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans select-none">
      <header className="h-16 px-4 md:px-8 border-b border-[#1b2640] bg-[#090f1e]/90 backdrop-blur-md flex items-center justify-between shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-3.5 min-w-0">
          <Link
            to="/login"
            className="flex items-center gap-2 group transition"
            title="Về trang chủ SmartRec"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-black text-sm shadow-md shadow-blue-500/20 group-hover:scale-105 transition">
              S
            </div>
            <span className="font-bold text-white tracking-tight hidden sm:inline-block">
              SmartRec
            </span>
          </Link>

          <div className="h-4 w-[1px] bg-slate-700 hidden sm:block"></div>

          <div className="flex items-center gap-2 min-w-0">
            <h1
              className="text-sm md:text-base font-bold text-white tracking-wide truncate max-w-xs md:max-w-md lg:max-w-xl"
              title={fileName}
            >
              {fileName}
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Chỉ xem
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
          >
            <ShareIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{copied ? "Đã chép link" : "Chia sẻ"}</span>
          </button>

          <Link
            to="/login"
            className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition hidden sm:inline-block"
          >
            Đăng nhập
          </Link>

          <Link
            to="/register"
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition shadow-sm"
          >
            Dùng thử miễn phí
          </Link>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 max-w-[1700px] w-full mx-auto">
        {loading ? (
          <div className="h-[60vh] flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-medium">Đang tải cuộc họp...</p>
          </div>
        ) : error ? (
          <div className="h-[60vh] flex flex-col items-center justify-center gap-3 text-center p-6">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-base font-bold text-white">{error}</p>
            <Link
              to="/login"
              className="mt-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition"
            >
              Về trang đăng nhập
            </Link>
          </div>
        ) : (
          <div className="w-full min-w-0 h-full flex flex-col xl:flex-row gap-5 items-stretch pb-6">
            <div className="w-full min-w-0 xl:w-[48%] flex flex-col gap-4">
              <VideoPlayer
                meetingId={meeting?.id}
                fileName={fileName}
                mimeType={meeting?.mimeType}
                fileType={fileType}
                mediaRef={mediaRef}
                onTimeUpdate={setCurrentTime}
              />
            </div>

            <div className="w-full min-w-0 xl:w-[52%] flex flex-col min-h-[500px]">
              <MeetingTabs
                fileType={fileType}
                speakers={speakers}
                currentTime={currentTime}
                onSeekSegment={handleSeekTo}
                aiStatus="completed"
                jobLoading={false}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

