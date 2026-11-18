import React, { useEffect, useMemo, useState } from 'react';
import ExportControlsSidebar from './ExportControlsSidebar';
import DocumentA4Preview from './DocumentA4Preview';
import {
  DEFAULT_EXPORT_CONFIG,
  EXPORT_FORMATS,
  buildExportDocumentModel,
  downloadExportFile,
  generateMarkdown,
  getPresetConfig,
  printDocumentPreview,
} from '../../services/documentExporterService';
import {
  DEFAULT_WORD_OPTIONS,
  downloadDocxFile,
} from '../../services/docxGeneratorService';

export default function LivePreviewExporter({
  meeting,
  speakers = [],
  speakerNameMap,
  summaryList,
  tasks,
  ocrSlides,
  defaultAuthorName = '',
  onExported,
}) {
  const [config, setConfig] = useState(() => ({
    ...DEFAULT_EXPORT_CONFIG,
    authorName: defaultAuthorName,
  }));
  const [wordOptions, setWordOptions] = useState(DEFAULT_WORD_OPTIONS);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!defaultAuthorName) return;
    setConfig((prev) => (prev.authorName ? prev : { ...prev, authorName: defaultAuthorName }));
  }, [defaultAuthorName]);

  const showNotice = (msg) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? '' : prev));
    }, 3000);
  };

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

  const hasSelectedSections = Object.values(config.sections || {}).some(Boolean);
  const activeFormatMeta =
    EXPORT_FORMATS.find((f) => f.id === config.format) || EXPORT_FORMATS[0];

  const handleSelectTemplate = (templateId) => {
    setConfig((prev) => getPresetConfig(templateId, prev));
  };

  const handleUpdateConfig = (patch) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const handleToggleSection = (sectionKey) => {
    setConfig((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [sectionKey]: !prev.sections?.[sectionKey],
      },
    }));
  };

  const handleCopyMarkdown = async () => {
    if (!hasSelectedSections) return;
    const md = generateMarkdown(docModel, config);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      }
      showNotice('Đã sao chép Markdown vào clipboard.');
    } catch {
      showNotice('Không thể truy cập clipboard trên trình duyệt này.');
    }
  };

  const handlePrintPdf = () => {
    if (!hasSelectedSections) return;
    const ok = printDocumentPreview(docModel, config);
    if (ok) {
      showNotice('Đang mở hộp thoại In / Lưu PDF (A4)...');
      onExported?.({ format: 'pdf', fileName: `${docModel.title}.pdf` });
    }
  };

  const handleDownloadDocx = (targetModel = docModel, targetWordOptions = wordOptions) => {
    if (!hasSelectedSections) return;
    const result = downloadDocxFile(targetModel, targetWordOptions, config);
    if (result.ok) {
      showNotice(`Đã tạo và tải xuống file Word ${result.fileName}`);
      onExported?.({ format: 'docx', fileName: result.fileName });
    }
  };

  const handleDownload = () => {
    if (!hasSelectedSections) return;
    if (config.format === 'docx') {
      handleDownloadDocx(docModel, wordOptions);
      return;
    }
    const result = downloadExportFile(docModel, config);
    if (result.ok) {
      showNotice(
        result.mode === 'print'
          ? 'Đang mở hộp thoại Lưu PDF (A4)...'
          : `Đã tải xuống tệp ${result.fileName}`
      );
      onExported?.({ format: config.format, fileName: result.fileName });
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full min-w-0">
      {/* Action Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-[#1b2640] bg-[#0c1324] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-white truncate max-w-md">
              {docModel.title}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#13203d] text-[#38bdf8] border border-[#243b6b]">
              {activeFormatMeta.label}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Xem trước trực tiếp thời gian thực — thay đổi tùy chọn bên trái sẽ cập nhật ngay trên bản xem trước.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!hasSelectedSections}
            onClick={handleCopyMarkdown}
            className="px-3 py-1.5 rounded-xl border border-[#233357] bg-[#090f1d] hover:bg-[#13203d] text-xs font-semibold text-slate-200 disabled:opacity-40 transition"
          >
            Copy Markdown
          </button>
          <button
            type="button"
            disabled={!hasSelectedSections}
            onClick={handlePrintPdf}
            className="px-3 py-1.5 rounded-xl border border-[#233357] bg-[#090f1d] hover:bg-[#13203d] text-xs font-semibold text-[#38bdf8] disabled:opacity-40 transition"
          >
            In / Lưu PDF
          </button>
          <button
            type="button"
            disabled={!hasSelectedSections}
            onClick={handleDownload}
            className="px-4 py-1.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-xs font-semibold text-white shadow-sm disabled:opacity-40 transition"
          >
            Xuất {activeFormatMeta.ext.toUpperCase()}
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

      {/* Split Workspace: Controls + Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-4 min-w-0">
          <ExportControlsSidebar
            config={config}
            stats={docModel.stats}
            onSelectTemplate={handleSelectTemplate}
            onUpdateConfig={handleUpdateConfig}
            onToggleSection={handleToggleSection}
          />
        </div>
        <div className="lg:col-span-8 min-w-0">
          <DocumentA4Preview
            docModel={docModel}
            config={config}
            wordOptions={wordOptions}
            onWordOptionsChange={setWordOptions}
            onDownloadDocx={handleDownloadDocx}
          />
        </div>
      </div>
    </div>
  );
}

