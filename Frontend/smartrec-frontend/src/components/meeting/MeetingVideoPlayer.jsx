import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function MeetingVideoPlayer({ 
  currentTime = '12:45', 
  duration = '28:30',
  onSeek 
}) {
  const attendees = [
    { id: 1, name: 'Alex Nguyen', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80' },
    { id: 2, name: 'Speaker A', img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80' },
    { id: 3, name: 'Speaker B', img: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80' },
    { id: 4, name: 'Sarah Chen', img: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80' },
    { id: 5, name: 'Anh Quyen', img: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80' },
    { id: 6, name: 'Chi Lan', img: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80' },
    { id: 7, name: 'Speaker C', img: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=200&q=80' },
    { id: 8, name: 'Marcus Brody', img: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=200&q=80' },
    { id: 9, name: 'Speaker D', img: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80' },
  ];

  // Subtitles dataset matching meeting timestamps
  const subtitlesData = [
    { start: 0, end: 15, speaker: 'Anh Quyền', text: 'Chào mọi người, chúng ta bắt đầu buổi họp kế hoạch Q4 hôm nay nhé.', textEn: 'Hello everyone, let us begin our Q4 planning meeting today.' },
    { start: 15, end: 32, speaker: 'Chị Lan', text: 'Chào anh Quyền, team em đã chuẩn bị xong các báo cáo doanh thu và tiến độ.', textEn: 'Hi Quyen, my team has prepared the revenue and progress reports.' },
    { start: 32, end: 312, speaker: 'Alex Nguyen', text: 'Về lộ trình sản phẩm Q4, chúng ta cần tập trung tái cấu trúc backend ở sprint 3-4.', textEn: 'Regarding Q4 product roadmap, we need to focus on backend refactoring in sprints 3-4.' },
    { start: 312, end: 527, speaker: 'Speaker A', text: 'Tiến độ phát triển API mới sẽ triển khai vào sprint 5 để kịp ra mắt ngày 15/12.', textEn: 'New API development progress will deploy in sprint 5 to meet Dec 15 launch.' },
    { start: 527, end: 750, speaker: 'Chị Lan', text: 'Tổng doanh thu quý này đạt 2.4 triệu USD, tăng trưởng 18% so với cùng kỳ.', textEn: 'Total revenue this quarter reached $2.4M, with 18% year-over-year growth.' },
    { start: 750, end: 792, speaker: 'Sarah Chen', text: 'Em đồng ý, nhưng cần thêm 2 sprint để giải quyết độ trễ và khả năng chịu tải.', textEn: 'I agree, but we should allocate two sprints to resolve stress test stability.' },
    { start: 792, end: 820, speaker: 'Alex Nguyen', text: 'Điểm rất tốt. Hãy đảm bảo môi trường dev sẵn sàng cho các bài kiểm tra sơ bộ.', textEn: 'Good point. Let us make sure dev environments are ready for preliminary tests.' },
    { start: 820, end: 845, speaker: 'Sarah Chen', text: 'Em sẽ đồng bộ với hạ tầng ngay hôm nay để khớp các API endpoint mới.', textEn: 'I will sync with infrastructure today to match the new API endpoints.' },
    { start: 845, end: 1024, speaker: 'Michael Scott', text: 'Cần đảm bảo tài liệu được cập nhật đồng thời để cả đội ngũ nắm rõ.', textEn: 'Ensure documentation is updated simultaneously so everyone stays aligned.' },
    { start: 1024, end: 1316, speaker: 'Marcus Brody', text: 'Rủi ro về độ trễ hiện ở mức cao, chúng ta cần giải pháp dự phòng sớm.', textEn: 'Latency risk is currently high, we need contingency mitigations early.' },
    { start: 1316, end: 1710, speaker: 'Anh Quyền', text: 'Đội ngũ kỹ thuật 12 nhân sự sẽ tập trung tối ưu để hoàn thành đúng hạn.', textEn: 'The 12-developer engineering team will focus on optimizing to meet deadline.' },
  ];

  // Key meeting segments for previous/next navigation
  const meetingSegments = [
    { time: 0, label: 'Bắt đầu cuộc họp', timeStr: '00:00' },
    { time: 15, label: 'Báo cáo doanh thu & tiến độ', timeStr: '00:15' },
    { time: 312, label: 'Q4 Product Roadmap', timeStr: '05:12' },
    { time: 527, label: 'Q4 Revenue Breakdown', timeStr: '08:47' },
    { time: 750, label: 'Project Timeline Overview', timeStr: '12:30' },
    { time: 765, label: 'Thảo luận Sprint & Test', timeStr: '12:45' },
    { time: 792, label: 'Đồng bộ Dev Environment', timeStr: '13:12' },
    { time: 820, label: 'Tương thích API mới', timeStr: '13:40' },
    { time: 845, label: 'Cập nhật tài liệu', timeStr: '14:05' },
    { time: 1024, label: 'Key Risks & Mitigations', timeStr: '17:04' },
    { time: 1316, label: 'Team Capacity Plan', timeStr: '21:56' },
  ];

  const parseSeconds = (timeStr) => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
    if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    return 0;
  };

  const formatTime = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hours > 0) {
      return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const totalSec = parseSeconds(duration) || 1710;
  const [currentSec, setCurrentSec] = useState(() => parseSeconds(currentTime));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringTimeline, setIsHoveringTimeline] = useState(false);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [hoverTime, setHoverTime] = useState('00:00');

  // Volume state with slider support
  const [volume, setVolume] = useState(80);
  const [prevVolume, setPrevVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [isHoveringVolume, setIsHoveringVolume] = useState(false);

  const [speed, setSpeed] = useState('1.0x');
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Subtitles state ('vi' | 'en' | 'off')
  const [subtitleTrack, setSubtitleTrack] = useState('vi');
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);

  // Resolution state ('1080p' | '720p' | '480p' | '360p' | 'Auto')
  const [resolution, setResolution] = useState('1080p');
  const [showResolutionMenu, setShowResolutionMenu] = useState(false);
  const [qualityToast, setQualityToast] = useState('');

  const containerRef = useRef(null);
  const progressBarRef = useRef(null);

  // Sync with prop when not dragging
  useEffect(() => {
    if (!isDragging) {
      setCurrentSec(parseSeconds(currentTime));
    }
  }, [currentTime, isDragging]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.menu-container')) {
        setShowSpeedMenu(false);
        setShowSubtitleMenu(false);
        setShowResolutionMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Playback timer
  useEffect(() => {
    if (!isPlaying) return undefined;
    const speedVal = parseFloat(speed) || 1.0;
    const intervalMs = Math.max(50, Math.round(1000 / speedVal));

    const interval = setInterval(() => {
      setCurrentSec((prev) => {
        if (prev >= totalSec) {
          setIsPlaying(false);
          return totalSec;
        }
        const next = prev + 1;
        if (onSeek) onSeek(formatTime(next));
        return next;
      });
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isPlaying, totalSec, speed, onSeek]);

  // Calculate seconds from mouse position
  const getSecondsFromEvent = useCallback((clientX) => {
    if (!progressBarRef.current) return 0;
    const rect = progressBarRef.current.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, offsetX / rect.width));
    return Math.round(ratio * totalSec);
  }, [totalSec]);

  // Timeline Mouse / Touch Handlers
  const handleTimelineMouseDown = (e) => {
    e.preventDefault();
    const newSec = getSecondsFromEvent(e.clientX);
    setCurrentSec(newSec);
    setIsDragging(true);
    if (onSeek) onSeek(formatTime(newSec));
  };

  const handleTimelineTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      const newSec = getSecondsFromEvent(e.touches[0].clientX);
      setCurrentSec(newSec);
      setIsDragging(true);
      if (onSeek) onSeek(formatTime(newSec));
    }
  };

  const handleTimelineMouseMove = (e) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, offsetX / rect.width));
    setHoverPercent(ratio * 100);
    setHoverTime(formatTime(Math.round(ratio * totalSec)));
  };

  // Drag listeners on window
  useEffect(() => {
    if (!isDragging) return undefined;

    const handlePointerMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const newSec = getSecondsFromEvent(clientX);
      setCurrentSec(newSec);
      if (onSeek) onSeek(formatTime(newSec));
    };

    const handlePointerUp = (e) => {
      const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
      const newSec = getSecondsFromEvent(clientX);
      setCurrentSec(newSec);
      setIsDragging(false);
      if (onSeek) onSeek(formatTime(newSec));
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove);
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [isDragging, getSecondsFromEvent, onSeek]);

  // Volume Handlers
  const toggleMute = () => {
    if (isMuted || volume === 0) {
      setIsMuted(false);
      setVolume(prevVolume || 80);
    } else {
      setPrevVolume(volume);
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (e) => {
    const newVol = Number(e.target.value);
    setVolume(newVol);
    if (newVol > 0) {
      setIsMuted(false);
      setPrevVolume(newVol);
    } else {
      setIsMuted(true);
    }
  };

  // Quick Navigation & Seek Actions
  // Button ở ảnh 2: Tua về mốc phân đoạn trước đó hoặc tua về ban đầu (00:00)
  const handlePrevSegment = () => {
    const current = currentSec;
    const prevSeg = [...meetingSegments]
      .reverse()
      .find((seg) => seg.time < current - 3);

    if (prevSeg) {
      setCurrentSec(prevSeg.time);
      if (onSeek) onSeek(prevSeg.timeStr);
      setQualityToast(`⏮ ${prevSeg.label} (${prevSeg.timeStr})`);
      setTimeout(() => setQualityToast(''), 2200);
    } else {
      setCurrentSec(0);
      if (onSeek) onSeek('00:00');
      setQualityToast('⏮ Tua về ban đầu (00:00)');
      setTimeout(() => setQualityToast(''), 2200);
    }
  };

  // Tua tới phân đoạn tiếp theo
  const handleNextSegment = () => {
    const nextSeg = meetingSegments.find((seg) => seg.time > currentSec + 2);
    if (nextSeg) {
      setCurrentSec(nextSeg.time);
      if (onSeek) onSeek(nextSeg.timeStr);
      setQualityToast(`⏭ ${nextSeg.label} (${nextSeg.timeStr})`);
      setTimeout(() => setQualityToast(''), 2200);
    }
  };

  const handleRewind10 = () => {
    const newSec = Math.max(0, currentSec - 10);
    setCurrentSec(newSec);
    if (onSeek) onSeek(formatTime(newSec));
  };

  const handleForward10 = () => {
    const newSec = Math.min(totalSec, currentSec + 10);
    setCurrentSec(newSec);
    if (onSeek) onSeek(formatTime(newSec));
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Find active subtitle matching current playback second
  const currentSubtitle = subtitlesData.find(
    (item) => currentSec >= item.start && currentSec < item.end
  ) || (currentSec < totalSec ? subtitlesData[0] : null);

  const progressPercent = Math.min(100, Math.max(0, (currentSec / totalSec) * 100));

  return (
    <div 
      ref={containerRef}
      className="w-full bg-[#080d1a] border border-[#1b2640] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
    >
      {/* 3x3 Video Attendees Grid */}
      <div className="relative aspect-video w-full bg-black flex items-center justify-center select-none overflow-hidden">
        <div className="w-[80%] aspect-video p-1.5 grid grid-cols-3 grid-rows-3 gap-2">
          {attendees.map((person) => (
            <div key={person.id} className="relative rounded-xl overflow-hidden bg-[#111928] border border-white/5 group">
              <img
                src={person.img}
                alt={person.name}
                className="w-full h-full object-cover brightness-90 group-hover:brightness-100 transition"
              />
              <div className="absolute bottom-1.5 left-2 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] text-white/90 font-medium">
                {person.name}
              </div>
            </div>
          ))}
        </div>

        {/* Dynamic Subtitles Overlay */}
        {subtitleTrack !== 'off' && currentSubtitle && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[85%] px-3.5 py-1.5 bg-black/80 backdrop-blur-md rounded-xl text-white text-xs md:text-sm font-medium text-center shadow-2xl border border-white/10 z-10 select-none transition-all">
            <span className="text-[#38bdf8] font-bold mr-1.5">[{currentSubtitle.speaker}]:</span>
            <span>{subtitleTrack === 'en' ? currentSubtitle.textEn : currentSubtitle.text}</span>
          </div>
        )}

        {/* Action toast notice */}
        {qualityToast && (
          <div className="absolute top-3 right-3 px-3 py-1 bg-black/80 backdrop-blur-md border border-[#38bdf8]/40 rounded-lg text-xs font-semibold text-[#38bdf8] shadow-2xl z-20 pointer-events-none animate-fade-in">
            {qualityToast}
          </div>
        )}
      </div>

      {/* Video Controls Bar */}
      <div className="px-4 py-3 bg-[#0a1122] border-t border-[#1a253d] flex flex-col gap-1.5">
        {/* Progress Bar with Draggable Scrubber */}
        <div 
          ref={progressBarRef}
          onMouseDown={handleTimelineMouseDown}
          onTouchStart={handleTimelineTouchStart}
          onMouseMove={handleTimelineMouseMove}
          onMouseEnter={() => setIsHoveringTimeline(true)}
          onMouseLeave={() => setIsHoveringTimeline(false)}
          className="relative w-full py-2.5 cursor-pointer select-none group flex items-center"
          title="Kéo hoặc nhấn để tua video"
        >
          {/* Background Track */}
          <div className="relative w-full h-1.5 bg-[#1e2a44] rounded-full overflow-visible transition-all group-hover:h-2">
            {/* Hover Track preview */}
            {isHoveringTimeline && (
              <div 
                className="absolute left-0 top-0 bottom-0 bg-white/20 rounded-full pointer-events-none transition-all"
                style={{ width: `${hoverPercent}%` }}
              />
            )}

            {/* Played Track */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#0284c7] to-[#38bdf8] rounded-full pointer-events-none"
              style={{ width: `${progressPercent}%` }}
            />

            {/* Scrubber Thumb Knob */}
            <div
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white border-2 border-[#38bdf8] rounded-full shadow-lg pointer-events-none transition-transform ${
                isDragging ? 'scale-125 ring-4 ring-[#38bdf8]/30' : 'scale-0 group-hover:scale-100'
              }`}
              style={{ left: `${progressPercent}%` }}
            />

            {/* Hover / Drag Preview Tooltip */}
            {(isHoveringTimeline || isDragging) && (
              <div
                className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 bg-[#0e172a] border border-[#2a3c63] text-white text-[10px] font-mono rounded shadow-lg pointer-events-none whitespace-nowrap z-20"
                style={{ left: `${isDragging ? progressPercent : hoverPercent}%` }}
              >
                {isDragging ? formatTime(currentSec) : hoverTime}
              </div>
            )}
          </div>
        </div>

        {/* Action Controls & Timestamps */}
        <div className="flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-1.5">
            {/* Nút ở Ảnh 2: Tua về phân đoạn trước / Tua về ban đầu (00:00) */}
            <button
              type="button"
              onClick={handlePrevSegment}
              className="p-1.5 rounded-lg text-slate-400 hover:text-[#38bdf8] hover:bg-[#152037] transition flex items-center justify-center"
              title="Phân đoạn trước / Về ban đầu (00:00)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>

            {/* Tua lùi 10 giây */}
            <button
              type="button"
              onClick={handleRewind10}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#152037] transition flex items-center justify-center"
              title="Tua lùi 10 giây"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                <text x="12" y="15" fill="currentColor" stroke="none" fontSize="7" fontWeight="bold" textAnchor="middle">10</text>
              </svg>
            </button>

            {/* Play/Pause */}
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-8 h-8 rounded-full bg-[#1e293b] hover:bg-[#2563eb] text-white flex items-center justify-center transition shadow-sm mx-0.5"
              title={isPlaying ? "Tạm dừng" : "Phát"}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="translate-x-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Tua tới 10 giây */}
            <button
              type="button"
              onClick={handleForward10}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#152037] transition flex items-center justify-center"
              title="Tua tới 10 giây"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                <text x="12" y="15" fill="currentColor" stroke="none" fontSize="7" fontWeight="bold" textAnchor="middle">10</text>
              </svg>
            </button>

            {/* Tua tới phân đoạn kế tiếp */}
            <button
              type="button"
              onClick={handleNextSegment}
              className="p-1.5 rounded-lg text-slate-400 hover:text-[#38bdf8] hover:bg-[#152037] transition flex items-center justify-center"
              title="Phân đoạn kế tiếp"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>

            {/* Cụm Điều chỉnh âm lượng (Nút Loa ở Ảnh 1 + Thanh kéo tăng giảm) */}
            <div 
              className="flex items-center group/vol ml-1.5 py-1"
              onMouseEnter={() => setIsHoveringVolume(true)}
              onMouseLeave={() => setIsHoveringVolume(false)}
            >
              {/* Nút Loa */}
              <button 
                type="button" 
                onClick={toggleMute}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#152037] transition flex items-center justify-center"
                title={isMuted || volume === 0 ? "Bật âm thanh" : `Tắt âm (${volume}%)`}
              >
                {isMuted || volume === 0 ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-rose-400">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l4.73 4.73H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : volume <= 40 ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 9v6h4l5 5V4L11 9H7z" />
                    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>

              {/* Thanh trượt kéo tăng giảm âm lượng */}
              <div className={`overflow-hidden transition-all duration-300 flex items-center ${
                isHoveringVolume ? 'w-20 opacity-100 ml-1.5' : 'w-0 opacity-0'
              }`}>
                <input 
                  type="range"
                  min="0"
                  max="100"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-18 h-1 rounded-lg appearance-none cursor-pointer accent-[#38bdf8] focus:outline-none"
                  style={{
                    background: `linear-gradient(to right, #38bdf8 ${(isMuted ? 0 : volume)}%, #1e2a44 ${(isMuted ? 0 : volume)}%)`
                  }}
                  title={`Âm lượng: ${isMuted ? 0 : volume}%`}
                />
              </div>
            </div>

            {/* Time Indicator */}
            <span className="font-mono text-[11px] text-slate-300 ml-2 select-none">
              <span className="text-white font-medium">{formatTime(currentSec)}</span> / {duration}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Speed Pill with Dropdown */}
            <div className="relative menu-container">
              <button
                type="button"
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowSubtitleMenu(false);
                  setShowResolutionMenu(false);
                }}
                className="px-2 py-0.5 text-[10px] font-semibold bg-[#18233c] text-slate-300 rounded border border-[#27375a] hover:bg-[#202e4e] transition cursor-pointer select-none"
                title="Tốc độ phát"
              >
                {speed}
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full mb-1.5 right-0 bg-[#0e172a] border border-[#27375a] rounded-xl shadow-2xl py-1.5 z-30 min-w-[80px]">
                  <div className="px-2.5 py-1 text-[9px] uppercase font-bold text-slate-400 border-b border-[#1b2640] mb-1">
                    Tốc độ
                  </div>
                  {['0.5x', '0.75x', '1.0x', '1.25x', '1.5x', '2.0x'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSpeed(s);
                        setShowSpeedMenu(false);
                      }}
                      className={`w-full text-left px-2.5 py-1 text-xs flex items-center justify-between transition ${
                        speed === s ? 'text-[#38bdf8] font-bold bg-[#1e2a44]' : 'text-slate-300 hover:bg-[#17223b]'
                      }`}
                    >
                      <span>{s}</span>
                      {speed === s && <span className="text-[#38bdf8]">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Resolution (Độ phân giải) Dropdown Menu */}
            <div className="relative menu-container">
              <button
                type="button"
                onClick={() => {
                  setShowResolutionMenu(!showResolutionMenu);
                  setShowSubtitleMenu(false);
                  setShowSpeedMenu(false);
                }}
                className="px-2 py-0.5 text-[10px] font-semibold bg-[#18233c] text-slate-300 rounded border border-[#27375a] hover:bg-[#202e4e] hover:text-white transition cursor-pointer select-none flex items-center gap-1"
                title="Độ phân giải"
              >
                <span>{resolution}</span>
                {resolution === '1080p' && (
                  <span className="px-1 py-[0.5px] bg-[#2563eb] text-white rounded text-[8px] font-bold tracking-tight">HD</span>
                )}
              </button>

              {showResolutionMenu && (
                <div className="absolute bottom-full mb-1.5 right-0 bg-[#0e172a] border border-[#27375a] rounded-xl shadow-2xl py-1.5 z-30 min-w-[155px]">
                  <div className="px-3 py-1 text-[9px] uppercase font-bold text-slate-400 border-b border-[#1b2640] mb-1">
                    Độ phân giải
                  </div>
                  {[
                    { id: '1080p', label: '1080p HD (Gốc)' },
                    { id: '720p', label: '720p HD' },
                    { id: '480p', label: '480p SD' },
                    { id: '360p', label: '360p' },
                    { id: 'Auto', label: 'Tự động (Auto)' },
                  ].map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => {
                        setResolution(res.id);
                        setShowResolutionMenu(false);
                        setQualityToast(`Chất lượng: ${res.label}`);
                        setTimeout(() => setQualityToast(''), 2500);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition ${
                        resolution === res.id 
                          ? 'text-[#38bdf8] font-bold bg-[#1e2a44]' 
                          : 'text-slate-300 hover:bg-[#17223b]'
                      }`}
                    >
                      <span className="truncate">{res.label}</span>
                      {resolution === res.id && <span className="text-[#38bdf8] ml-2">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Subtitles CC with Dropdown Menu */}
            <div className="relative menu-container">
              <button 
                type="button" 
                onClick={() => {
                  setShowSubtitleMenu(!showSubtitleMenu);
                  setShowResolutionMenu(false);
                  setShowSpeedMenu(false);
                }}
                className={`p-1.5 rounded-lg transition flex items-center justify-center ${
                  subtitleTrack !== 'off' 
                    ? 'text-[#38bdf8] bg-[#1e2a44] border border-[#38bdf8]/50 shadow-sm' 
                    : 'text-slate-400 hover:text-white hover:bg-[#152037]'
                }`}
                title={subtitleTrack === 'off' ? 'Bật phụ đề' : `Phụ đề (${subtitleTrack === 'vi' ? 'Tiếng Việt' : 'Tiếng Anh'})`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 01-1 1h-3a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1z" />
                </svg>
              </button>

              {showSubtitleMenu && (
                <div className="absolute bottom-full mb-1.5 right-0 bg-[#0e172a] border border-[#27375a] rounded-xl shadow-2xl py-1.5 z-30 min-w-[155px]">
                  <div className="px-3 py-1 text-[9px] uppercase font-bold text-slate-400 border-b border-[#1b2640] mb-1">
                    Cài đặt phụ đề
                  </div>
                  {[
                    { id: 'off', label: 'Tắt phụ đề' },
                    { id: 'vi', label: 'Tiếng Việt (AI tạo)' },
                    { id: 'en', label: 'Tiếng Anh (Bản dịch)' },
                  ].map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => {
                        setSubtitleTrack(sub.id);
                        setShowSubtitleMenu(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition ${
                        subtitleTrack === sub.id 
                          ? 'text-[#38bdf8] font-bold bg-[#1e2a44]' 
                          : 'text-slate-300 hover:bg-[#17223b]'
                      }`}
                    >
                      <span>{sub.label}</span>
                      {subtitleTrack === sub.id && <span className="text-[#38bdf8] ml-2">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen */}
            <button 
              type="button" 
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#152037] transition"
              title={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
