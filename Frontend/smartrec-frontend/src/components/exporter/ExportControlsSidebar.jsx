import React from 'react';
import {
  ACCENT_THEMES,
  EXPORT_FORMATS,
  EXPORT_TEMPLATES,
} from '../../services/documentExporterService';

export default function ExportControlsSidebar({
  config,
  stats,
  onSelectTemplate,
  onUpdateConfig,
  onToggleSection,
}) {
  const sections = config.sections || {};

  const sectionItems = [
    { key: 'metadata', label: 'Thông tin cuộc họp & Thành phần', count: stats?.speakerCount },
    { key: 'summary', label: 'Tóm tắt điều hành (AI Summary)', count: stats?.summaryCount },
    { key: 'tasks', label: 'Bảng Action Items & Phân công', count: stats?.taskCount },
    { key: 'ocr', label: 'Slide Keyframes & OCR', count: stats?.ocrCount },
    { key: 'transcript', label: 'Transcript chi tiết cuộc họp', count: stats?.transcriptCount },
  ];

  return (
    <aside className="flex flex-col gap-4 bg-[#090f1d] border border-[#1b2640] rounded-2xl p-4 overflow-y-auto">
      {/* 1. Template Presets */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          1. Mẫu tài liệu (Presets)
        </span>
        <div className="flex flex-col gap-2">
          {EXPORT_TEMPLATES.map((tpl) => {
            const active = config.templateId === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onSelectTemplate(tpl.id)}
                className={`text-left p-2.5 rounded-xl border transition ${active
                  ? 'bg-[#13203d] border-[#38bdf8] text-white shadow-sm'
                  : 'bg-[#0c1324] border-[#1b2742] text-slate-300 hover:border-slate-500'
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{tpl.label}</span>
                  {active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2563eb] text-white font-semibold">
                      Đang chọn
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                  {tpl.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Export Format */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#162038]">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          2. Định dạng tải về
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {EXPORT_FORMATS.map((fmt) => {
            const active = config.format === fmt.id;
            return (
              <button
                key={fmt.id}
                type="button"
                onClick={() => onUpdateConfig({ format: fmt.id })}
                className={`px-2.5 py-2 rounded-xl border text-left transition ${active
                  ? 'bg-[#13203d] border-[#38bdf8] text-white'
                  : 'bg-[#0c1324] border-[#1b2742] text-slate-300 hover:border-slate-500'
                  }`}
              >
                <div className="text-xs font-semibold truncate">{fmt.label}</div>
                <div className="text-[10px] text-slate-400">{fmt.badge}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Section Toggles */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#162038]">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          3. Thành phần nội dung
        </span>
        <div className="flex flex-col gap-1.5">
          {sectionItems.map((item) => (
            <label
              key={item.key}
              className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#0c1324] border border-[#17223a] hover:border-[#24365c] cursor-pointer text-xs"
            >
              <span className="flex items-center gap-2 text-slate-200">
                <input
                  type="checkbox"
                  checked={Boolean(sections[item.key])}
                  onChange={() => onToggleSection(item.key)}
                  className="rounded border-slate-600 text-[#2563eb] focus:ring-0"
                />
                <span>{item.label}</span>
              </span>
              {item.count !== undefined && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#13203d] text-[#38bdf8] font-semibold">
                  {item.count}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* 4. Metadata & Styling */}
      <div className="flex flex-col gap-2.5 pt-2 border-t border-[#162038]">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          4. Tùy chỉnh tiêu đề &amp; Giao diện
        </span>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Tiêu đề tài liệu (để trống dùng tên cuộc họp)</span>
          <input
            type="text"
            value={config.documentTitle}
            onChange={(e) => onUpdateConfig({ documentTitle: e.target.value })}
            placeholder="Ví dụ: Biên bản họp Sprint Review Q4"
            className="px-2.5 py-1.5 rounded-lg bg-[#0c1324] border border-[#1b2742] text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>Số / Ký hiệu văn bản</span>
            <input
              type="text"
              value={config.documentCode || ''}
              onChange={(e) => onUpdateConfig({ documentCode: e.target.value })}
              placeholder="Tự động (BBH-...)"
              className="px-2.5 py-1.5 rounded-lg bg-[#0c1324] border border-[#1b2742] text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>Kính gửi / Nơi nhận</span>
            <input
              type="text"
              value={config.recipientGroup || ''}
              onChange={(e) => onUpdateConfig({ recipientGroup: e.target.value })}
              placeholder="Ban Giám đốc..."
              className="px-2.5 py-1.5 rounded-lg bg-[#0c1324] border border-[#1b2742] text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>Đơn vị / Team</span>
            <input
              type="text"
              value={config.organizationName}
              onChange={(e) => onUpdateConfig({ organizationName: e.target.value })}
              className="px-2.5 py-1.5 rounded-lg bg-[#0c1324] border border-[#1b2742] text-xs text-slate-100 focus:outline-none focus:border-[#38bdf8]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>Người lập biên bản</span>
            <input
              type="text"
              value={config.authorName}
              onChange={(e) => onUpdateConfig({ authorName: e.target.value })}
              placeholder="Thư ký AI · SmartRec"
              className="px-2.5 py-1.5 rounded-lg bg-[#0c1324] border border-[#1b2742] text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-400">Màu chủ đạo trang in</span>
          <div className="flex items-center gap-1.5">
            {ACCENT_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                title={theme.label}
                aria-label={theme.label}
                onClick={() => onUpdateConfig({ accentTheme: theme.id })}
                className={`w-5 h-5 rounded-full border-2 transition ${config.accentTheme === theme.id
                  ? 'border-white scale-110'
                  : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                style={{ backgroundColor: theme.primary }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 pt-1 text-xs text-slate-300">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeCoverPage !== false}
              onChange={(e) => onUpdateConfig({ includeCoverPage: e.target.checked })}
              className="rounded border-slate-600"
            />
            <span>Trang bìa chính thức (Cover + Logo)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeToc !== false}
              onChange={(e) => onUpdateConfig({ includeToc: e.target.checked })}
              className="rounded border-slate-600"
            />
            <span>Mục lục nội dung (TOC)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(config.includeTimestamps)}
              onChange={(e) => onUpdateConfig({ includeTimestamps: e.target.checked })}
              className="rounded border-slate-600"
            />
            <span>Kèm mốc thời gian (timestamps)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(config.includeWatermark)}
              onChange={(e) => onUpdateConfig({ includeWatermark: e.target.checked })}
              className="rounded border-slate-600"
            />
            <span>Kèm chân trang SmartRec AI</span>
          </label>
        </div>
      </div>
    </aside>
  );
}

