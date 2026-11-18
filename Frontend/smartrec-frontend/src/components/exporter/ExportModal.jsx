import React, { useEffect, useMemo, useState } from 'react';
import LivePreviewExporter from './LivePreviewExporter';
import {
  CSV_SCOPES,
  DEFAULT_EXPORT_CONFIG,
  buildExportDocumentModel,
  buildSafeFileName,
  downloadExportFile,
  getCsvTableData,
} from '../../services/documentExporterService';
import {
  DEFAULT_WORD_OPTIONS,
  WORD_FONTS,
  downloadDocxFile,
  paginateWordBlocks,
} from '../../services/docxGeneratorService';

const MODAL_FORMAT_CARDS = [
  {
    id: 'docx',
    title: 'Word (.docx)',
    badge: 'OOXML chuẩn Office',
    description: 'Trang bìa chính thức, Logo SmartRec, Mục lục tự động, Bảng Action Items & Chữ ký.',
    accentBorder: 'border-blue-500/60 bg-blue-950/35',
    badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  },
  {
    id: 'pdf',
    title: 'PDF (A4 Vector)',
    badge: 'In / Lưu PDF',
    description: 'Giữ nguyên bố cục Trang bìa, Mục lục & font tiếng Việt sắc nét khi in hoặc lưu PDF.',
    accentBorder: 'border-rose-500/60 bg-rose-950/30',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  },
  {
    id: 'csv',
    title: 'CSV (.csv)',
    badge: 'Excel / Google Sheets',
    description: 'Bảng dữ liệu chuẩn UTF-8 BOM mở không lỗi dấu tiếng Việt trong Excel.',
    accentBorder: 'border-emerald-500/60 bg-emerald-950/30',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
];

export default function ExportModal({
  isOpen,
  onClose,
  meeting,
  speakers = [],
  speakerNameMap,
  summaryList,
  tasks,
  ocrSlides,
  defaultAuthorName = '',
  initialMode = 'quick',
  initialFormat = 'docx',
  onExported,
}) {
  const [mode, setMode] = useState(initialMode);
  const [config, setConfig] = useState(() => ({
    ...DEFAULT_EXPORT_CONFIG,
    format: initialFormat || 'docx',
    authorName: defaultAuthorName,
  }));
  const [wordOptions, setWordOptions] = useState(DEFAULT_WORD_OPTIONS);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    setNotice('');
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!defaultAuthorName) return;
    setConfig((prev) => (prev.authorName ? prev : { ...prev, authorName: defaultAuthorName }));
  }, [defaultAuthorName]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const docModel = useMemo(
    () =>
      buildExportDocumentModel({
        meeting,
        speakers,
        speakerNameMap,
        summaryList,
        tasks,
        ocrSlides,
        config,
      }),
    [meeting, speakers, speakerNameMap, summaryList, tasks, ocrSlides, config]
  );

  const wordPagesCount = useMemo(() => {
    if (config.format !== 'docx') return docModel.stats.estimatedPages;
    return paginateWordBlocks(docModel, wordOptions, config).length;
  }, [config, docModel, wordOptions]);

  const csvPreview = useMemo(() => {
    if (config.format !== 'csv') return { headers: [], rows: [] };
    return getCsvTableData(docModel, config);
  }, [config, docModel]);

  if (!isOpen) return null;

  const hasSelectedSections =
    config.format === 'csv' || Object.values(config.sections || {}).some(Boolean);
  const previewFileName = buildSafeFileName(docModel.title, config.format || 'docx');

  const toggleSection = (key) => {
    setConfig((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [key]: !prev.sections?.[key],
      },
    }));
  };

  const handleDownload = () => {
    if (!hasSelectedSections) return;
    if (config.format === 'docx') {
      const res = downloadDocxFile(docModel, wordOptions, config);
      if (res.ok) {
        setNotice(`Đã tải về file Word: ${res.fileName}`);
        onExported?.({ format: 'docx', fileName: res.fileName });
      }
      return;
    }

    const res = downloadExportFile(docModel, config);
    if (res.ok) {
      setNotice(
        res.mode === 'print'
          ? 'Đang mở hộp thoại In / Lưu PDF (A4)...'
          : `Đã tải về tệp: ${res.fileName}`
      );
      onExported?.({ format: config.format, fileName: res.fileName });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 sm:p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        className={`w-full ${
          mode === 'preview' ? 'max-w-7xl' : 'max-w-3xl'
        } max-h-[92vh] flex flex-col rounded-2xl border border-[#233357] bg-[#070b19] text-slate-100 shadow-2xl overflow-hidden transition-all`}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[#18233c] bg-[#090f1d] shrink-0">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#38bdf8]">
              SmartRec Document Exporter
            </span>
            <h2 id="export-modal-title" className="text-sm sm:text-base font-bold text-white">
              Tùy chọn định dạng xuất file &amp; Tải về
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-[#0c1324] border border-[#1b2742] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode('quick')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  mode === 'quick'
                    ? 'bg-[#2563eb] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Tùy chọn nhanh
              </button>
              <button
                type="button"
                onClick={() => setMode('preview')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  mode === 'preview'
                    ? 'bg-[#2563eb] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Live Preview đầy đủ
              </button>
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
        </div>

        {/* Body */}
        {mode === 'preview' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            <LivePreviewExporter
              meeting={meeting}
              speakers={speakers}
              speakerNameMap={speakerNameMap}
              summaryList={summaryList}
              tasks={tasks}
              ocrSlides={ocrSlides}
              defaultAuthorName={defaultAuthorName}
              initialFormat={config.format}
              onExported={onExported}
            />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
              {/* 1. Three Required Format Selector Cards: Word, PDF, CSV */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  1. Chọn định dạng tệp xuất
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {MODAL_FORMAT_CARDS.map((card) => {
                    const selected = config.format === card.id;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => setConfig((prev) => ({ ...prev, format: card.id }))}
                        className={`text-left rounded-2xl border p-4 transition flex flex-col justify-between gap-2 ${
                          selected
                            ? `${card.accentBorder} shadow-md`
                            : 'border-[#1b2742] bg-[#0c1324] hover:border-slate-500'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-white">{card.title}</span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${card.badgeClass}`}
                            >
                              {selected ? 'Đang chọn' : card.badge}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300/90 mt-2 leading-relaxed">
                            {card.description}
                          </p>
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 pt-1">
                          {card.id === 'docx'
                            ? `${wordPagesCount} trang A4 · OOXML`
                            : card.id === 'pdf'
                              ? 'A4 Vector Print Ready'
                              : `${csvPreview.rows.length || docModel.tasks.length} dòng bảng tính`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. File Title & Format-specific Options */}
              <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <span className="text-[11px] font-semibold text-slate-400">
                      Tiêu đề tài liệu / Tên tệp
                    </span>
                    <input
                      type="text"
                      value={config.documentTitle}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, documentTitle: e.target.value }))
                      }
                      placeholder={meeting?.fileName || meeting?.title || 'Biên bản cuộc họp'}
                      className="px-3 py-2 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
                    />
                  </label>

                  {config.format === 'csv' ? (
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[11px] font-semibold text-slate-400">
                        Phạm vi dữ liệu CSV
                      </span>
                      <select
                        value={config.csvScope || 'tasks'}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, csvScope: e.target.value }))
                        }
                        aria-label="Chọn dữ liệu xuất CSV"
                        className="px-3 py-2 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-white focus:outline-none focus:border-[#38bdf8]"
                      >
                        {CSV_SCOPES.map((sc) => (
                          <option key={sc.id} value={sc.id}>
                            {sc.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      <span className="text-[11px] font-semibold text-slate-400">
                        Font chữ văn bản {config.format === 'docx' ? '(Word)' : '(A4)'}
                      </span>
                      <select
                        value={wordOptions.fontFamily}
                        onChange={(e) =>
                          setWordOptions((prev) => ({ ...prev, fontFamily: e.target.value }))
                        }
                        aria-label="Font chữ văn bản"
                        className="px-3 py-2 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-white focus:outline-none focus:border-[#38bdf8]"
                      >
                        {WORD_FONTS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {config.format === 'csv' ? (
                  <div className="rounded-xl border border-[#18243e] bg-[#090f1d] overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-[#162038] text-[11px] text-slate-400 flex justify-between">
                      <span>Xem nhanh 3 dòng đầu CSV (UTF-8 BOM)</span>
                      <span>Tổng {csvPreview.rows.length} dòng</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="text-[#38bdf8] border-b border-[#162038]">
                            {csvPreview.headers.slice(0, 5).map((h) => (
                              <th key={h} className="py-1.5 px-2.5 font-semibold whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#141e35]">
                          {csvPreview.rows.slice(0, 3).map((row, idx) => (
                            <tr key={idx}>
                              {row.slice(0, 5).map((cell, cIdx) => (
                                <td key={cIdx} className="py-1.5 px-2.5 text-slate-300 truncate max-w-[160px]">
                                  {String(cell || '—')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-[#090f1d] border border-[#17223a] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.includeCoverPage !== false}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, includeCoverPage: e.target.checked }))
                        }
                        className="rounded border-slate-600"
                      />
                      <span>Trang bìa &amp; Logo</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-[#090f1d] border border-[#17223a] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.includeToc !== false}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, includeToc: e.target.checked }))
                        }
                        className="rounded border-slate-600"
                      />
                      <span>Mục lục tự động</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-[#090f1d] border border-[#17223a] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(config.sections?.summary)}
                        onChange={() => toggleSection('summary')}
                        className="rounded border-slate-600"
                      />
                      <span>Tóm tắt AI ({docModel.stats.summaryCount})</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-[#090f1d] border border-[#17223a] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(config.sections?.tasks)}
                        onChange={() => toggleSection('tasks')}
                        className="rounded border-slate-600"
                      />
                      <span>Action Items ({docModel.stats.taskCount})</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-[#090f1d] border border-[#17223a] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(config.sections?.ocr)}
                        onChange={() => toggleSection('ocr')}
                        className="rounded border-slate-600"
                      />
                      <span>Slide OCR ({docModel.stats.ocrCount})</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-[#090f1d] border border-[#17223a] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(config.sections?.transcript)}
                        onChange={() => toggleSection('transcript')}
                        className="rounded border-slate-600"
                      />
                      <span>Transcript ({docModel.stats.transcriptCount})</span>
                    </label>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#162038] text-[11px] text-slate-400">
                  <span>
                    Tệp sẽ tải: <code className="text-[#38bdf8]">{previewFileName}</code>
                  </span>
                  <button
                    type="button"
                    onClick={() => setMode('preview')}
                    className="text-[#38bdf8] hover:underline font-semibold"
                  >
                    Mở Live Preview &amp; chỉnh sửa chi tiết →
                  </button>
                </div>
              </div>

              {notice && (
                <div
                  role="status"
                  className="px-4 py-2 rounded-xl border border-emerald-500/40 bg-emerald-950/35 text-xs text-emerald-300"
                >
                  {notice}
                </div>
              )}
            </div>

            {/* Modal Footer with Download Button */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-[#18233c] bg-[#090f1d] shrink-0">
              <span className="text-[11px] text-slate-400">
                Đã đồng bộ bản sửa Task, Speaker &amp; Transcript mới nhất
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-[#233357] bg-[#0c1324] hover:bg-[#141d33] text-xs font-semibold text-slate-300 hover:text-white transition"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={!hasSelectedSections}
                  onClick={handleDownload}
                  className="px-5 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-45 text-xs font-semibold text-white shadow-md transition inline-flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>
                    {config.format === 'pdf'
                      ? 'Tải về PDF (A4)'
                      : config.format === 'csv'
                        ? 'Tải về CSV (.csv)'
                        : 'Tải về Word (.docx)'}
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

