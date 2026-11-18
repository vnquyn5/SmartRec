import React, { useState } from 'react';
import mockOcrData from '../../mocks/mock_ocr.json';


function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map((p) => Number(p.trim()) || 0);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]; 
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]; 
  }
  return Number(timeStr) || 0;
}

export default function SlideGallery({ onSeekSegment }) {
  
  const slides = mockOcrData || [];

  
  const [selectedSlide, setSelectedSlide] = useState(null);
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  
  const handleSeek = (timeStr, e) => {
    if (e) e.stopPropagation();
    const seconds = parseTimeToSeconds(timeStr);
    if (typeof onSeekSegment === 'function') {
      onSeekSegment(seconds);
    }
  };

  
  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 2000);
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Tiêu đề & Thống kê */}
      <div className="flex items-center justify-between pb-2 border-b border-[#1b2640]">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block"></span>
            Slide Keyframes & OCR Gallery
          </h3>
          <p className="text-xs text-slate-400 mt-1 pl-3.5">
            {slides.length} slides phát hiện · Nhấp vào thumbnail để nhảy đến video hoặc xem chi tiết OCR
          </p>
        </div>
      </div>

      {/* DANH SÁCH THUMBNAIL KEYFRAME SLIDE (SCRUM-277) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {slides.map((slide, index) => (
          <div
            key={index}
            className="group relative bg-[#0d1526] hover:bg-[#121c33] border border-[#1b2742] hover:border-[#38bdf8]/50 rounded-2xl p-3 flex flex-col gap-3 transition-all duration-200 shadow-md hover:shadow-cyan-950/20"
          >
            {/* Vùng Slide Thumbnail + Nút nhảy video (SCRUM-279) */}
            <div
              onClick={(e) => handleSeek(slide.timestamp, e)}
              className="relative w-full aspect-video rounded-xl bg-gradient-to-br from-[#11192e] to-[#080d19] border border-[#1d2a4a] flex flex-col justify-between p-3 cursor-pointer overflow-hidden group/thumb"
              title="Nhấp để nhảy đến mốc thời gian này trong video"
            >
              {/* Badge mốc thời gian */}
              <div className="flex items-center justify-between z-10">
                <span className="inline-flex items-center gap-1.5 bg-black/85 backdrop-blur-md px-2 py-0.5 rounded-md text-[11px] font-mono font-bold text-[#38bdf8] border border-[#38bdf8]/30">
                  <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {slide.timestamp}
                </span>

                <span className="text-[10px] font-medium text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded">
                  Slide #{index + 1}
                </span>
              </div>

              {/* Mô phỏng Slide Content trong thumbnail */}
              <div className="my-auto text-center px-2 py-1">
                <p className="text-xs font-bold text-slate-200 line-clamp-1 group-hover/thumb:text-[#38bdf8] transition">
                  {slide.slide_title}
                </p>
                <div className="mt-1.5 flex justify-center gap-1">
                  <span className="w-8 h-1 bg-[#1e2e50] rounded-full"></span>
                  <span className="w-14 h-1 bg-[#1e2e50] rounded-full"></span>
                  <span className="w-6 h-1 bg-[#1e2e50] rounded-full"></span>
                </div>
              </div>

              {/* Hover Overlay: Nhảy đến video */}
              <div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition backdrop-blur-[1px]">
                <span className="bg-[#0b1324] text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#38bdf8] shadow-lg flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-[#38bdf8]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Tua video đến {slide.timestamp}
                </span>
              </div>
            </div>

            {/* Thông tin Slide & Tags */}
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-200 line-clamp-1">
                  {slide.slide_title}
                </h4>
                {/* Nút mở Drawer OCR (SCRUM-278) */}
                <button
                  type="button"
                  onClick={() => setSelectedSlide(slide)}
                  className="shrink-0 text-[11px] font-semibold text-[#38bdf8] hover:text-white bg-[#142340] hover:bg-[#1d3563] px-2.5 py-1 rounded-md border border-[#233b6b] transition"
                >
                  Xem OCR
                </button>
              </div>

              {/* Danh sách Tags */}
              <div className="flex flex-wrap gap-1.5">
                {(slide.tags || []).map((tag, tagIdx) => (
                  <span
                    key={tagIdx}
                    className="text-[10px] font-medium bg-[#131f38] text-slate-300 border border-[#21345d] px-2 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* DRAWER UI XEM ẢNH SLIDE PHÓNG TO & VĂN BẢN OCR (SCRUM-278) */}
      {selectedSlide && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm transition-opacity"
          onClick={() => setSelectedSlide(null)}
        >
          <div
            className="w-full max-w-2xl h-full bg-[#0a1122] border-l border-[#1b2742] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Drawer */}
            <div className="p-4 border-b border-[#1b2640] flex items-center justify-between bg-[#0e172c]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#38bdf8]"></span>
                <h3 className="text-sm font-bold text-white truncate max-w-md">
                  Chi tiết Keyframe Slide & OCR
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSlide(null)}
                className="w-7 h-7 rounded-lg bg-[#18233d] text-slate-400 hover:text-white hover:bg-[#223257] flex items-center justify-center transition"
              >
                ✕
              </button>
            </div>

            {/* Nội dung Drawer: Phóng to slide + Văn bản OCR */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
              {/* KHU VỰC 1: ẢNH SLIDE PHÓNG TO */}
              <div className="w-full rounded-2xl bg-gradient-to-br from-[#10192e] to-[#080d19] border border-[#203157] p-6 flex flex-col items-center justify-center min-h-[220px] relative shadow-inner">
                <div className="text-center max-w-md">
                  <span className="inline-block px-3 py-1 bg-[#192b4d] text-[#38bdf8] text-xs font-mono font-bold rounded-full mb-3 border border-[#2a457a]">
                    Mốc thời gian: {selectedSlide.timestamp}
                  </span>
                  <h2 className="text-lg font-bold text-white">
                    {selectedSlide.slide_title}
                  </h2>
                  <p className="text-xs text-slate-400 mt-2 italic">
                    Keyframe snapshot trích xuất tự động từ video
                  </p>
                </div>

                {/* Nút tua video ngay trong Drawer (SCRUM-279) */}
                <button
                  type="button"
                  onClick={(e) => handleSeek(selectedSlide.timestamp, e)}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-bold transition shadow-md shadow-blue-900/30"
                >
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Tua video đến slide này ({selectedSlide.timestamp})
                </button>
              </div>

              {/* KHU VỰC 2: VĂN BẢN OCR TRÍCH XUẤT */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <svg className="w-4 h-4 text-[#38bdf8]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Văn bản nhận dạng (OCR Raw Text)
                  </h4>
                  <button
                    type="button"
                    onClick={() => handleCopyText(selectedSlide.raw_text)}
                    className="text-xs text-[#38bdf8] hover:text-white bg-[#142340] hover:bg-[#1d3563] px-3 py-1 rounded-lg border border-[#233b6b] transition flex items-center gap-1.5"
                  >
                    {copiedFeedback ? '✓ Đã sao chép' : 'Sao chép văn bản'}
                  </button>
                </div>

                {/* Khung hiển thị nội dung OCR */}
                <div className="w-full rounded-xl bg-[#070b16] border border-[#1b2742] p-4 text-xs font-mono leading-relaxed text-slate-300 whitespace-pre-wrap select-text">
                  {selectedSlide.raw_text}
                </div>
              </div>

              {/* KHU VỰC 3: CÁC THẺ TAGS / ENTITIES */}
              <div className="flex flex-col gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Từ khóa & Metrics phát hiện
                </h4>
                <div className="flex flex-wrap gap-2">
                  {(selectedSlide.tags || []).map((tag, idx) => (
                    <span
                      key={idx}
                      className="text-xs font-semibold bg-[#111c33] text-cyan-300 border border-[#20345b] px-3 py-1 rounded-lg"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}