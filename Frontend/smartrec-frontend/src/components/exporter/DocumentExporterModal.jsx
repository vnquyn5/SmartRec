import React from 'react';
import LivePreviewExporter from './LivePreviewExporter';

export default function DocumentExporterModal({
  isOpen,
  onClose,
  meeting,
  speakers = [],
  speakerNameMap,
  defaultAuthorName = '',
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 sm:p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exporter-modal-title"
        className="w-full max-w-7xl max-h-[92vh] flex flex-col rounded-2xl border border-[#233357] bg-[#070b19] text-slate-100 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[#18233c] bg-[#090f1d] shrink-0">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#38bdf8]">
              SmartRec Document Exporter
            </span>
            <h2 id="exporter-modal-title" className="text-sm sm:text-base font-bold text-white">
              Xuất biên bản &amp; tài liệu cuộc họp (Live Preview)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ xuất tài liệu"
            className="w-8 h-8 rounded-lg border border-[#1b2742] bg-[#0c1324] text-slate-300 hover:text-white flex items-center justify-center text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <LivePreviewExporter
            meeting={meeting}
            speakers={speakers}
            speakerNameMap={speakerNameMap}
            defaultAuthorName={defaultAuthorName}
          />
        </div>
      </div>
    </div>
  );
}

