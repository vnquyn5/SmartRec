import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { timeToSeconds, formatSecondsToTime } from "../../utils/timeFormat";

/**
 * Helper highlight từ khóa an toàn hỗ trợ tiếng Việt có dấu
 */
function HighlightText({ text = "", keyword = "" }) {
  if (!keyword.trim() || !text) return <span>{text}</span>;

  try {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = String(text).split(regex);

    return (
      <span>
        {parts.map((part, index) =>
          regex.test(part) ? (
            <mark
              key={index}
              className="bg-blue-500/35 text-blue-200 font-semibold px-0.5 rounded shadow-sm"
            >
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  } catch {
    return <span>{text}</span>;
  }
}

export default function WorkspaceSearchBar({
  transcripts = [],
  tasks = [],
  slides = [],
  meetings = [],
  onSeek,
  onSelectMeeting,
  onFilterChange,
  placeholder = "Tìm theo từ khóa, người nói, nội dung... (Ctrl + K)",
  className = "",
  pageSize = 5,
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Bộ lọc tương tác (Dropdown filters)
  const [selectedSpeaker, setSelectedSpeaker] = useState("all");
  const [selectedType, setSelectedType] = useState("all"); // 'all' | 'transcript' | 'task' | 'slide' | 'meeting'
  const [selectedTimeRange, setSelectedTimeRange] = useState("all"); // 'all' | '0-5' | '5-15' | '15+'
  const [selectedSort, setSelectedSort] = useState("relevance"); // 'relevance' | 'time_asc' | 'time_desc'

  // Phân trang
  const [currentPage, setCurrentPage] = useState(1);

  // Dropdown mở riêng lẻ
  const [activeDropdown, setActiveDropdown] = useState(null); // 'speaker' | 'type' | 'time' | 'sort' | null

  // Trạng thái tìm kiếm: 'idle' | 'loading' | 'success' | 'empty' | 'error'
  const [searchStatus, setSearchStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const abortControllerRef = useRef(null);
  const isComposingRef = useRef(false);

  // Debounce 250ms an toàn gõ tiếng Việt (Telex / VNI)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isComposingRef.current) {
        setDebouncedQuery(query.trim());
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Phím tắt toàn cục Ctrl+K hoặc /
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Đóng khi click ngoài
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setActiveDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Danh sách các speaker duy nhất để lọc
  const speakerOptions = useMemo(() => {
    const set = new Set();
    transcripts.forEach((t) => {
      if (t.speakerName) set.add(t.speakerName);
    });
    tasks.forEach((task) => {
      if (task.assignee) set.add(task.assignee);
    });
    return Array.from(set);
  }, [transcripts, tasks]);

  // Số lượng filter đang áp dụng
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedSpeaker !== "all") count++;
    if (selectedType !== "all") count++;
    if (selectedTimeRange !== "all") count++;
    if (selectedSort !== "relevance") count++;
    return count;
  }, [selectedSpeaker, selectedType, selectedTimeRange, selectedSort]);

  // Reset mọi filter về mặc định
  const handleResetFilters = useCallback(() => {
    setSelectedSpeaker("all");
    setSelectedType("all");
    setSelectedTimeRange("all");
    setSelectedSort("relevance");
    setCurrentPage(1);
    onFilterChange?.({ speaker: "all", type: "all", timeRange: "all", sort: "relevance" });
  }, [onFilterChange]);

  // Reset trang về 1 khi query hoặc filter thay đổi
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIndex(0);
  }, [debouncedQuery, selectedSpeaker, selectedType, selectedTimeRange, selectedSort]);

  // Xử lý Tìm kiếm với AbortController (Chống Stale Request)
  const [allFilteredResults, setAllFilteredResults] = useState([]);

  useEffect(() => {
    // Hủy request đang xử lý trước đó nếu có
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Nếu không có từ khóa và không có filter, trạng thái là idle
    if (!debouncedQuery && activeFiltersCount === 0) {
      setSearchStatus("idle");
      setAllFilteredResults([]);
      return;
    }

    setSearchStatus("loading");
    setErrorMessage("");

    const executeFilter = async () => {
      try {
        // Mô phỏng độ trễ xử lý async nhẹ để kiểm chứng abort logic
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 80);
          controller.signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });

        if (controller.signal.aborted) return;

        const q = debouncedQuery.toLowerCase();
        const list = [];

        // 1. Lọc Transcripts
        if (selectedType === "all" || selectedType === "transcript") {
          transcripts.forEach((t) => {
            const textMatch = !q || t.text?.toLowerCase().includes(q);
            const speakerMatch = !q || t.speakerName?.toLowerCase().includes(q);
            if (textMatch || speakerMatch) {
              const seconds = Number(t.seconds) || timeToSeconds(t.timeStart);
              // Lọc theo speaker
              if (selectedSpeaker !== "all" && t.speakerName !== selectedSpeaker) {
                return;
              }
              // Lọc theo timeRange
              if (selectedTimeRange === "0-5" && seconds > 300) return;
              if (selectedTimeRange === "5-15" && (seconds < 300 || seconds > 900)) return;
              if (selectedTimeRange === "15+" && seconds < 900) return;

              list.push({
                id: `transcript-${t.id || t.chunkKey}`,
                type: "transcript",
                typeLabel: "Biên bản",
                typeBadgeColor: "bg-blue-500/15 text-blue-400 border-blue-500/30",
                title: t.speakerName || "Người nói",
                snippet: t.text || "",
                timestamp: t.timeStart || formatSecondsToTime(seconds),
                seconds,
              });
            }
          });
        }

        // 2. Lọc Tasks
        if (selectedType === "all" || selectedType === "task") {
          tasks.forEach((task) => {
            const contentMatch = !q || task.content?.toLowerCase().includes(q);
            const assigneeMatch = !q || task.assignee?.toLowerCase().includes(q);
            if (contentMatch || assigneeMatch) {
              const seconds = timeToSeconds(task.timestamp);
              if (selectedSpeaker !== "all" && task.assignee !== selectedSpeaker) {
                return;
              }
              if (selectedTimeRange === "0-5" && seconds > 300) return;
              if (selectedTimeRange === "5-15" && (seconds < 300 || seconds > 900)) return;
              if (selectedTimeRange === "15+" && seconds < 900) return;

              list.push({
                id: `task-${task.task_index || task.id}`,
                type: "task",
                typeLabel: "Công việc",
                typeBadgeColor: "bg-purple-500/15 text-purple-400 border-purple-500/30",
                title: `Nhiệm vụ #${task.task_index || 1}${task.assignee ? ` · ${task.assignee}` : ""}`,
                snippet: task.content || "",
                timestamp: task.timestamp || "00:00",
                seconds,
              });
            }
          });
        }

        // 3. Lọc Slides OCR
        if (selectedType === "all" || selectedType === "slide") {
          slides.forEach((slide, idx) => {
            const titleMatch = !q || slide.slide_title?.toLowerCase().includes(q);
            const rawMatch = !q || slide.raw_text?.toLowerCase().includes(q);
            if (titleMatch || rawMatch) {
              const seconds = timeToSeconds(slide.timestamp);
              if (selectedTimeRange === "0-5" && seconds > 300) return;
              if (selectedTimeRange === "5-15" && (seconds < 300 || seconds > 900)) return;
              if (selectedTimeRange === "15+" && seconds < 900) return;

              list.push({
                id: `slide-${idx}`,
                type: "slide",
                typeLabel: "Slide OCR",
                typeBadgeColor: "bg-amber-500/15 text-amber-400 border-amber-500/30",
                title: slide.slide_title || `Slide #${idx + 1}`,
                snippet: slide.raw_text || "",
                timestamp: slide.timestamp || "00:00",
                seconds,
              });
            }
          });
        }

        // 4. Lọc Meetings (nếu có cung cấp cho Workspace chung)
        if (selectedType === "all" || selectedType === "meeting") {
          meetings.forEach((m) => {
            const title = m.fileName || m.title || "";
            if (!q || title.toLowerCase().includes(q)) {
              list.push({
                id: `meeting-${m.id}`,
                type: "meeting",
                typeLabel: "Cuộc họp",
                typeBadgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                title: title || "Cuộc họp chưa đặt tên",
                snippet: `Trạng thái: ${m.status || "Hoàn tất"} · Ngày tải lên: ${m.createdAt ? new Date(m.createdAt).toLocaleDateString("vi-VN") : "--"}`,
                timestamp: formatSecondsToTime(m.durationSeconds || 0),
                seconds: 0,
                meetingId: m.id,
              });
            }
          });
        }

        // Áp dụng sắp xếp
        if (selectedSort === "time_asc") {
          list.sort((a, b) => a.seconds - b.seconds);
        } else if (selectedSort === "time_desc") {
          list.sort((a, b) => b.seconds - a.seconds);
        }

        if (controller.signal.aborted) return;

        setAllFilteredResults(list);
        setSearchStatus(list.length > 0 ? "success" : "empty");
      } catch (err) {
        if (err.name !== "AbortError") {
          setSearchStatus("error");
          setErrorMessage("Đã xảy ra lỗi khi tìm kiếm. Vui lòng thử lại.");
        }
      }
    };

    executeFilter();

    return () => {
      controller.abort();
    };
  }, [
    debouncedQuery,
    selectedSpeaker,
    selectedType,
    selectedTimeRange,
    selectedSort,
    activeFiltersCount,
    transcripts,
    tasks,
    slides,
    meetings,
  ]);

  // Phân trang kết quả
  const totalResults = allFilteredResults.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return allFilteredResults.slice(start, start + pageSize);
  }, [allFilteredResults, currentPage, pageSize]);

  // Xử lý chọn kết quả
  const handleSelectResult = useCallback(
    (item) => {
      if (!item) return;
      if (item.meetingId && typeof onSelectMeeting === "function") {
        onSelectMeeting(item.meetingId);
      } else if (typeof onSeek === "function") {
        onSeek(item.seconds);
      }
      setIsOpen(false);
      setActiveDropdown(null);
    },
    [onSeek, onSelectMeeting]
  );

  // Điều hướng bằng bàn phím
  const handleKeyDown = (e) => {
    if (!isOpen || paginatedResults.length === 0) {
      if (e.key === "Enter" && debouncedQuery) {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % paginatedResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + paginatedResults.length) % paginatedResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelectResult(paginatedResults[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setActiveDropdown(null);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full font-sans ${className}`}>
      {/* KHỐI 1: Thanh Tìm Kiếm Chính (Full Width Input - Không bị bóp nghẹt, không có thanh cuộn) */}
      <div className="relative w-full flex items-center">
        <div className="absolute left-3.5 text-slate-400 pointer-events-none flex items-center">
          {searchStatus === "loading" ? (
            <svg className="w-4 h-4 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            setDebouncedQuery(e.target.value.trim());
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full bg-[#0a1122] hover:bg-[#0c1428] focus:bg-[#0c1428] text-xs sm:text-sm text-[#f7f9ff] placeholder-slate-400 pl-10 pr-20 py-2.5 rounded-xl border border-[#1b2640] focus:border-blue-500/60 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition shadow-inner"
        />

        <div className="absolute right-2.5 flex items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setDebouncedQuery("");
                inputRef.current?.focus();
              }}
              className="p-1 text-slate-400 hover:text-white rounded-md transition cursor-pointer"
              title="Xóa tìm kiếm"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-[#162035] border border-[#233252] rounded shadow-sm">
            <span className="text-[11px]">⌘</span>K
          </kbd>
        </div>
      </div>

      {/* KHỐI 2: Hàng Dropdown Filters (Dùng flex-wrap gap-2 chống tràn, KHÔNG dùng overflow-x-auto để tránh thanh cuộn) */}
      <div className="flex items-center flex-wrap gap-2 mt-2.5">
        {/* Dropdown 1: Người nói (Speaker) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveDropdown(activeDropdown === "speaker" ? null : "speaker")}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer shrink-0 ${
              selectedSpeaker !== "all"
                ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                : "bg-[#0d1526] hover:bg-[#121c33] text-slate-300 border-[#1b2742]"
            }`}
          >
            <span>{selectedSpeaker === "all" ? "Người nói" : selectedSpeaker}</span>
            <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {activeDropdown === "speaker" && (
            <div className="absolute top-full left-0 mt-1.5 w-48 bg-[#0d1526] border border-[#1b2742] rounded-xl shadow-2xl py-1.5 z-50 max-h-56 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setSelectedSpeaker("all");
                  setActiveDropdown(null);
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#152038] ${
                  selectedSpeaker === "all" ? "text-blue-400 font-bold bg-blue-500/10" : "text-slate-300"
                }`}
              >
                <span>Tất cả người nói</span>
                {selectedSpeaker === "all" && <span>✓</span>}
              </button>
              {speakerOptions.map((spk) => (
                <button
                  key={spk}
                  type="button"
                  onClick={() => {
                    setSelectedSpeaker(spk);
                    setActiveDropdown(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#152038] ${
                    selectedSpeaker === spk ? "text-blue-400 font-bold bg-blue-500/10" : "text-slate-300"
                  }`}
                >
                  <span className="truncate">{spk}</span>
                  {selectedSpeaker === spk && <span>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dropdown 2: Loại nội dung (Topic/Type) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveDropdown(activeDropdown === "type" ? null : "type")}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer shrink-0 ${
              selectedType !== "all"
                ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                : "bg-[#0d1526] hover:bg-[#121c33] text-slate-300 border-[#1b2742]"
            }`}
          >
            <span>
              {selectedType === "all"
                ? "Loại nội dung"
                : selectedType === "transcript"
                  ? "Biên bản"
                  : selectedType === "task"
                    ? "Công việc"
                    : selectedType === "slide"
                      ? "Slide OCR"
                      : "Cuộc họp"}
            </span>
            <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {activeDropdown === "type" && (
            <div className="absolute top-full left-0 mt-1.5 w-44 bg-[#0d1526] border border-[#1b2742] rounded-xl shadow-2xl py-1.5 z-50">
              {[
                { id: "all", label: "Tất cả nội dung" },
                { id: "transcript", label: "Biên bản hội thoại" },
                { id: "task", label: "Nhiệm vụ & Action Items" },
                { id: "slide", label: "Slide trình chiếu OCR" },
                ...(meetings.length > 0 ? [{ id: "meeting", label: "Cuộc họp Workspace" }] : []),
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedType(item.id);
                    setActiveDropdown(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#152038] ${
                    selectedType === item.id ? "text-purple-400 font-bold bg-purple-500/10" : "text-slate-300"
                  }`}
                >
                  <span>{item.label}</span>
                  {selectedType === item.id && <span>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dropdown 3: Khoảng thời gian (Time Range) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveDropdown(activeDropdown === "time" ? null : "time")}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer shrink-0 ${
              selectedTimeRange !== "all"
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                : "bg-[#0d1526] hover:bg-[#121c33] text-slate-300 border-[#1b2742]"
            }`}
          >
            <span>
              {selectedTimeRange === "all"
                ? "Thời lượng"
                : selectedTimeRange === "0-5"
                  ? "00:00 - 05:00"
                  : selectedTimeRange === "5-15"
                    ? "05:00 - 15:00"
                    : "15:00+"}
            </span>
            <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {activeDropdown === "time" && (
            <div className="absolute top-full left-0 mt-1.5 w-44 bg-[#0d1526] border border-[#1b2742] rounded-xl shadow-2xl py-1.5 z-50">
              {[
                { id: "all", label: "Toàn bộ thời lượng" },
                { id: "0-5", label: "00:00 - 05:00 phút" },
                { id: "5-15", label: "05:00 - 15:00 phút" },
                { id: "15+", label: "Từ 15:00 phút trở lên" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedTimeRange(item.id);
                    setActiveDropdown(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#152038] ${
                    selectedTimeRange === item.id ? "text-cyan-400 font-bold bg-cyan-500/10" : "text-slate-300"
                  }`}
                >
                  <span>{item.label}</span>
                  {selectedTimeRange === item.id && <span>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dropdown 4: Sắp xếp (Sort) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveDropdown(activeDropdown === "sort" ? null : "sort")}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer shrink-0 ${
              selectedSort !== "relevance"
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : "bg-[#0d1526] hover:bg-[#121c33] text-slate-300 border-[#1b2742]"
            }`}
          >
            <span>{selectedSort === "relevance" ? "Sắp xếp" : selectedSort === "time_asc" ? "Tăng dần" : "Giảm dần"}</span>
            <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {activeDropdown === "sort" && (
            <div className="absolute top-full right-0 mt-1.5 w-44 bg-[#0d1526] border border-[#1b2742] rounded-xl shadow-2xl py-1.5 z-50">
              {[
                { id: "relevance", label: "Độ khớp liên quan" },
                { id: "time_asc", label: "Thời gian: Cũ ➔ Mới" },
                { id: "time_desc", label: "Thời gian: Mới ➔ Cũ" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedSort(item.id);
                    setActiveDropdown(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#152038] ${
                    selectedSort === item.id ? "text-amber-400 font-bold bg-amber-500/10" : "text-slate-300"
                  }`}
                >
                  <span>{item.label}</span>
                  {selectedSort === item.id && <span>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Nút đặt lại nhanh nếu có filter */}
        {activeFiltersCount > 0 && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 transition flex items-center gap-1 cursor-pointer shrink-0"
            title="Xóa tất cả bộ lọc đang chọn"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            <span>Đặt lại ({activeFiltersCount})</span>
          </button>
        )}
      </div>

      {/* KHỐI 2: Thanh Filter Pills (Hiển thị các bộ lọc đang kích hoạt) */}
      {activeFiltersCount > 0 && (
        <div className="flex items-center gap-2 mt-2.5 flex-wrap text-xs">
          <span className="text-[11px] text-slate-400 font-semibold">Đang lọc theo:</span>
          {selectedSpeaker !== "all" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px]">
              <span>Người nói: {selectedSpeaker}</span>
              <button
                type="button"
                onClick={() => setSelectedSpeaker("all")}
                className="hover:text-white"
              >
                ✕
              </button>
            </span>
          )}
          {selectedType !== "all" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px]">
              <span>Loại: {selectedType}</span>
              <button
                type="button"
                onClick={() => setSelectedType("all")}
                className="hover:text-white"
              >
                ✕
              </button>
            </span>
          )}
          {selectedTimeRange !== "all" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[11px]">
              <span>Thời lượng: {selectedTimeRange}</span>
              <button
                type="button"
                onClick={() => setSelectedTimeRange("all")}
                className="hover:text-white"
              >
                ✕
              </button>
            </span>
          )}
          {selectedSort !== "relevance" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px]">
              <span>Xếp: {selectedSort === "time_asc" ? "Tăng dần" : "Giảm dần"}</span>
              <button
                type="button"
                onClick={() => setSelectedSort("relevance")}
                className="hover:text-white"
              >
                ✕
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={handleResetFilters}
            className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 underline cursor-pointer ml-1"
          >
            Đặt lại tất cả
          </button>
        </div>
      )}

      {/* KHỐI 3: Dropdown Kết Quả Tìm Kiếm (Phân biệt rõ 5 trạng thái: TR01, BR03) */}
      {isOpen && (debouncedQuery || activeFiltersCount > 0) && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#090f1d] border border-[#1e2a44] rounded-2xl shadow-2xl z-50 overflow-hidden backdrop-blur-md">
          {/* Header kết quả */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#18233c] text-xs text-slate-400 bg-[#070c18]">
            <div>
              {searchStatus === "loading" ? (
                <span className="text-blue-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping"></span>
                  Đang truy vấn dữ liệu Workspace…
                </span>
              ) : (
                <span>
                  Tìm thấy <strong className="text-white font-bold">{totalResults}</strong> kết quả phù hợp
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 hidden sm:inline">
              <kbd className="px-1 py-0.5 bg-[#141d31] rounded">↑</kbd> <kbd className="px-1 py-0.5 bg-[#141d31] rounded">↓</kbd> để chọn · <kbd className="px-1 py-0.5 bg-[#141d31] rounded">Enter</kbd> để tua video
            </span>
          </div>

          {/* Body: Danh sách kết quả */}
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2 space-y-1.5">
            {searchStatus === "loading" && (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="p-3 rounded-xl bg-[#0d1425] animate-pulse space-y-2">
                    <div className="h-3 bg-[#17223b] rounded w-1/4"></div>
                    <div className="h-3 bg-[#17223b] rounded w-3/4"></div>
                  </div>
                ))}
              </div>
            )}

            {searchStatus === "error" && (
              <div className="py-6 px-4 text-center">
                <p className="text-xs text-rose-300 font-semibold mb-2">{errorMessage}</p>
                <button
                  type="button"
                  onClick={() => setDebouncedQuery(query.trim())}
                  className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition"
                >
                  Thử lại
                </button>
              </div>
            )}

            {searchStatus === "empty" && (
              <div className="py-8 text-center text-slate-400 text-xs px-4">
                <div className="w-10 h-10 rounded-xl bg-[#131b2e] flex items-center justify-center mx-auto mb-2 text-slate-500">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </div>
                <p className="font-semibold text-slate-300">Không tìm thấy kết quả nào phù hợp</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Hãy thử gõ từ khóa khác hoặc điều chỉnh lại các tiêu chí bộ lọc.
                </p>
                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="mt-3 px-3 py-1 rounded-lg bg-[#141e33] hover:bg-[#1a2744] text-blue-400 text-xs font-semibold transition"
                  >
                    Xóa tất cả bộ lọc
                  </button>
                )}
              </div>
            )}

            {searchStatus === "success" &&
              paginatedResults.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectResult(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`px-3.5 py-2.5 rounded-xl cursor-pointer transition flex items-start justify-between gap-3 ${
                      isSelected
                        ? "bg-[#141f38] text-white shadow-sm ring-1 ring-blue-500/30"
                        : "text-slate-300 hover:bg-[#10172a] hover:text-white"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${item.typeBadgeColor}`}>
                          {item.typeLabel}
                        </span>
                        <span className="text-xs font-bold text-[#f7f9ff] truncate">
                          {item.title}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        <HighlightText text={item.snippet} keyword={debouncedQuery} />
                      </p>
                    </div>

                    {/* Mốc thời gian & Nút Seek */}
                    {item.timestamp && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectResult(item);
                        }}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1a253d] hover:bg-blue-600 hover:text-white text-[11px] font-mono text-blue-400 border border-blue-500/20 transition cursor-pointer"
                        title="Tua Video đến thời điểm này"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        <span>{item.timestamp}</span>
                      </button>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Footer: Phân trang (Pagination) */}
          {searchStatus === "success" && totalPages > 1 && (
            <div className="px-4 py-2 border-t border-[#18233c] bg-[#070c18] flex items-center justify-between text-xs text-slate-400">
              <span>
                Trang <strong className="text-white">{currentPage}</strong> / {totalPages} (Tổng số {totalResults} kết quả)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-lg bg-[#121a2d] hover:bg-[#18233d] disabled:opacity-40 text-slate-200 transition cursor-pointer"
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded-lg bg-[#121a2d] hover:bg-[#18233d] disabled:opacity-40 text-slate-200 transition cursor-pointer"
                >
                  Sau
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
