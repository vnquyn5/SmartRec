import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { timeToSeconds } from "../../utils/timeFormat";

/**
 * Highlight từ khóa tìm kiếm trong văn bản
 */
function HighlightText({ text = "", keyword = "" }) {
  if (!keyword.trim() || !text) return <span>{text}</span>;
  
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = String(text).split(regex);

  return (
    <span>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <mark
            key={index}
            className="bg-blue-500/30 text-blue-300 font-semibold px-0.5 rounded"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
}

export default function MeetingSearchBar({
  transcripts = [],
  tasks = [],
  slides = [],
  onSeek,
  className = "",
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Debounce query 250ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Phím tắt toàn cục: Ctrl+K hoặc / để focus
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

  // Đóng dropdown khi click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Tổng hợp và lọc kết quả tìm kiếm đa nguồn
  const results = useMemo(() => {
    if (!debouncedQuery) return [];
    const q = debouncedQuery.toLowerCase();
    const list = [];

    // 1. Tìm trong Transcripts
    transcripts.forEach((t) => {
      const textMatch = t.text?.toLowerCase().includes(q);
      const speakerMatch = t.speakerName?.toLowerCase().includes(q);
      if (textMatch || speakerMatch) {
        list.push({
          id: `transcript-${t.id || t.chunkKey}`,
          type: "transcript",
          typeLabel: "Biên bản",
          typeColor: "bg-blue-500/15 text-blue-400 border-blue-500/30",
          title: t.speakerName || "Người nói",
          snippet: t.text || "",
          timestamp: t.timeStart || "00:00",
          seconds: Number(t.seconds) || timeToSeconds(t.timeStart),
        });
      }
    });

    // 2. Tìm trong Action Items / Tasks
    tasks.forEach((task) => {
      const contentMatch = task.content?.toLowerCase().includes(q);
      const assigneeMatch = task.assignee?.toLowerCase().includes(q);
      if (contentMatch || assigneeMatch) {
        list.push({
          id: `task-${task.task_index || task.id}`,
          type: "task",
          typeLabel: "Công việc",
          typeColor: "bg-purple-500/15 text-purple-400 border-purple-500/30",
          title: `Nhiệm vụ #${task.task_index || 1}${task.assignee ? ` · ${task.assignee}` : ""}`,
          snippet: task.content || "",
          timestamp: task.timestamp || "00:00",
          seconds: timeToSeconds(task.timestamp),
        });
      }
    });

    // 3. Tìm trong Slides Keyframe OCR
    slides.forEach((slide, idx) => {
      const titleMatch = slide.slide_title?.toLowerCase().includes(q);
      const rawMatch = slide.raw_text?.toLowerCase().includes(q);
      if (titleMatch || rawMatch) {
        list.push({
          id: `slide-${idx}`,
          type: "slide",
          typeLabel: "Slide OCR",
          typeColor: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          title: slide.slide_title || `Slide #${idx + 1}`,
          snippet: slide.raw_text || "",
          timestamp: slide.timestamp || "00:00",
          seconds: timeToSeconds(slide.timestamp),
        });
      }
    });

    return list.slice(0, 15); // Lấy tối đa 15 kết quả phù hợp nhất
  }, [debouncedQuery, transcripts, tasks, slides]);

  // Reset selectedIndex khi query thay đổi
  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery]);

  // Cuộn item đang chọn vào view khi di chuyển phím
  useEffect(() => {
    if (listRef.current && results.length > 0) {
      const activeElement = listRef.current.children[selectedIndex];
      if (activeElement) {
        activeElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex, results.length]);

  const handleSelectResult = useCallback(
    (item) => {
      if (!item) return;
      if (typeof onSeek === "function") {
        onSeek(item.seconds);
      }
      setIsOpen(false);
    },
    [onSeek]
  );

  // Điều hướng bằng bàn phím
  const handleKeyDown = (e) => {
    if (!isOpen || results.length === 0) {
      if (e.key === "Enter" && results.length > 0) {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelectResult(results[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full max-w-xl font-sans ${className}`}
    >
      {/* Search Input Bar */}
      <div className="relative flex items-center">
        <div className="absolute left-3.5 text-slate-400 pointer-events-none flex items-center">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Tìm trong biên bản, công việc, slide... (Ctrl + K)"
          className="w-full bg-[#0a1122] hover:bg-[#0c1428] focus:bg-[#0c1428] text-xs sm:text-sm text-[#f7f9ff] placeholder-slate-400 pl-10 pr-20 py-2.5 rounded-xl border border-[#1b2640] focus:border-blue-500/60 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition shadow-inner"
        />

        <div className="absolute right-2.5 flex items-center gap-1 pointer-events-none">
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="pointer-events-auto p-1 text-slate-400 hover:text-white rounded-md transition"
              title="Xóa tìm kiếm"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-[#162035] border border-[#233252] rounded shadow-sm">
              <span className="text-[11px]">⌘</span>K
            </kbd>
          )}
        </div>
      </div>

      {/* Dropdown Menu kết quả */}
      {isOpen && debouncedQuery && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#090f1d] border border-[#1e2a44] rounded-2xl shadow-2xl z-50 overflow-hidden backdrop-blur-md">
          {/* Header kết quả */}
          <div className="flex items-center justify-between px-3.5 py-2 border-b border-[#18233c] text-[11px] text-slate-400 bg-[#070c18]">
            <span>
              Tìm thấy <strong className="text-white">{results.length}</strong> kết quả cho "{debouncedQuery}"
            </span>
            <span className="text-[10px] text-slate-400 hidden sm:inline">
              Dùng phím <kbd className="px-1 py-0.5 bg-[#141d31] rounded">↑</kbd> <kbd className="px-1 py-0.5 bg-[#141d31] rounded">↓</kbd> để chọn · <kbd className="px-1 py-0.5 bg-[#141d31] rounded">Enter</kbd> để tua video
            </span>
          </div>

          {/* Danh sách items */}
          <div ref={listRef} className="max-h-72 overflow-y-auto p-1.5 space-y-1">
            {results.length > 0 ? (
              results.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectResult(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`px-3 py-2.5 rounded-xl cursor-pointer transition flex items-start justify-between gap-3 ${
                      isSelected
                        ? "bg-[#141e35] text-white"
                        : "text-slate-300 hover:bg-[#10172a] hover:text-white"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${item.typeColor}`}
                        >
                          {item.typeLabel}
                        </span>
                        <span className="text-xs font-semibold text-[#f7f9ff] truncate">
                          {item.title}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        <HighlightText text={item.snippet} keyword={debouncedQuery} />
                      </p>
                    </div>

                    {/* Timestamp seek pill */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectResult(item);
                      }}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1a253d] hover:bg-blue-600 hover:text-white text-[11px] font-mono text-blue-400 border border-blue-500/20 transition cursor-pointer"
                      title="Nhấn để tua video đến thời điểm này"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                      <span>{item.timestamp}</span>
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="py-8 text-center text-slate-400 text-xs">
                Không tìm thấy kết quả phù hợp với từ khóa "<strong>{debouncedQuery}</strong>".
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
