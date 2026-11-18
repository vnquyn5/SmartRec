import React, { useMemo, useState } from 'react';
import SmartRecDocLogo from './SmartRecDocLogo';
import {
  ACCENT_THEMES,
  DEFAULT_EXPORT_CONFIG,
  buildExportDocumentModel,
} from '../../services/documentExporterService';
import {
  DEFAULT_WORD_OPTIONS,
  WORD_FONTS,
  WORD_FONT_SIZES,
  WORD_LINE_SPACINGS,
  WORD_MARGIN_PRESETS,
  downloadDocxFile,
  paginateWordBlocks,
  resolveWordFont,
  resolveWordMargin,
} from '../../services/docxGeneratorService';

function WordRuler({ widthPx, marginPx }) {
  const marks = Array.from({ length: 21 }, (_, cm) => cm);
  return (
    <div
      style={{ width: `${widthPx}px` }}
      aria-hidden="true"
      className="mx-auto mb-3 h-6 rounded-md border border-[#1d2b4c] bg-[#0b1326] relative overflow-hidden select-none shadow-inner"
    >
      <div
        className="absolute inset-y-0 left-0 bg-[#1a2747]/90 border-r border-[#38bdf8]/40"
        style={{ width: `${marginPx}px` }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-[#1a2747]/90 border-l border-[#38bdf8]/40"
        style={{ width: `${marginPx}px` }}
      />
      <div className="relative h-full flex items-end justify-between px-2 pb-1 text-[9px] font-mono text-slate-400">
        {marks.map((cm) => (
          <div key={cm} className="flex flex-col items-center">
            <span className="leading-none">{cm % 2 === 0 ? cm : ''}</span>
            <span className="w-px h-1.5 bg-slate-500/70 mt-0.5" />
          </div>
        ))}
      </div>
    </div>
  );
}

function renderCoverPage({ docModel, theme }) {
  return (
    <div className="flex-1 flex flex-col justify-between border border-slate-200 rounded-sm p-6 sm:p-8 bg-white">
      {/* Top Formal Institution & Code Header */}
      <div
        className="flex flex-wrap items-start justify-between gap-4 pb-4"
        style={{ borderBottom: `2px solid ${theme.primary}` }}
      >
        <SmartRecDocLogo size={40} organizationName={docModel.organizationName} />
        <div className="text-right text-[0.82em] text-slate-600 leading-snug">
          <div>
            <strong>Số / Ký hiệu:</strong>{' '}
            <span className="font-mono text-slate-800">{docModel.documentCode}</span>
          </div>
          <div>
            <strong>Ngày ban hành:</strong> {docModel.exportedAtLabel}
          </div>
          <div>
            <strong>Phân loại:</strong> Tài liệu lưu hành nội bộ
          </div>
        </div>
      </div>

      {/* Center Hero Title Block */}
      <div
        className="my-8 py-8 px-6 text-center rounded-md"
        style={{
          backgroundColor: theme.soft,
          borderTop: `3px solid ${theme.primary}`,
          borderBottom: `3px solid ${theme.primary}`,
        }}
      >
        <div
          className="text-[0.85em] font-bold uppercase tracking-widest mb-2"
          style={{ color: theme.primary }}
        >
          {docModel.documentSubtitle}
        </div>
        <h2 className="text-[1.9em] font-extrabold text-slate-900 leading-tight break-words">
          {docModel.title}
        </h2>
        <p className="text-[0.9em] text-slate-600 mt-3 max-w-lg mx-auto leading-relaxed">
          Tài liệu tổng hợp chính thức nội dung thảo luận, kết luận điều hành và bảng phân công nhiệm vụ được chuẩn hóa từ SmartRec AI.
        </p>
      </div>

      {/* Formal Administrative Details Table */}
      <div className="mb-8">
        <table className="w-full border-collapse text-[0.88em]">
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="py-2 pr-3 font-semibold text-slate-600 w-40">Kính gửi / Nơi nhận:</td>
              <td className="py-2 text-slate-900 font-medium">{docModel.recipientGroup}</td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="py-2 pr-3 font-semibold text-slate-600">Đơn vị chủ trì:</td>
              <td className="py-2 text-slate-900">{docModel.organizationName}</td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="py-2 pr-3 font-semibold text-slate-600">Người lập biên bản:</td>
              <td className="py-2 text-slate-900">{docModel.authorName}</td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="py-2 pr-3 font-semibold text-slate-600">Ngày họp &amp; Thời lượng:</td>
              <td className="py-2 text-slate-900">
                {docModel.createdAtLabel} · Thời lượng {docModel.durationLabel}
              </td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="py-2 pr-3 font-semibold text-slate-600">Địa điểm / Nền tảng:</td>
              <td className="py-2 text-slate-900">{docModel.meetingLocation}</td>
            </tr>
            <tr>
              <td className="py-2 pr-3 font-semibold text-slate-600 align-top">Thành phần tham dự:</td>
              <td className="py-2 text-slate-900">{docModel.participants?.join(', ') || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cover Footer */}
      <div className="pt-4 border-t border-slate-200 text-center text-[0.8em] text-slate-500 italic">
        Văn bản được định dạng chuẩn bởi {docModel.organizationName} · SmartRec Meeting Intelligence
      </div>
    </div>
  );
}

function renderWordBlock(block, { docModel, config, theme }) {
  switch (block.kind) {
    case 'cover_page':
      return <React.Fragment key={block.id}>{renderCoverPage({ docModel, theme })}</React.Fragment>;

    case 'header':
      return (
        <header
          key={block.id}
          className="pb-3 mb-4 flex items-center justify-between gap-3"
          style={{ borderBottom: `2.5px solid ${theme.primary}` }}
        >
          <div>
            <div
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: theme.primary }}
            >
              {docModel.organizationName} · {docModel.documentCode}
            </div>
            <h2 className="text-[1.45em] font-bold text-slate-900 mt-1 break-words leading-tight">
              {docModel.title}
            </h2>
          </div>
          <SmartRecDocLogo size={34} showWordmark={false} />
        </header>
      );

    case 'toc':
      return (
        <nav
          key={block.id}
          aria-label="Mục lục tài liệu Word"
          className="mb-5 rounded-md border border-slate-200 bg-slate-50/90 px-4 py-3 text-[0.92em]"
        >
          <div
            className="font-bold uppercase tracking-wide text-[0.88em] pb-1.5 mb-2 border-b"
            style={{ color: theme.primary, borderColor: theme.border }}
          >
            Mục lục tài liệu
          </div>
          <ul className="flex flex-col gap-1.5">
            {block.entries.map((entry, idx) => (
              <li
                key={entry.key || idx}
                className="flex items-baseline justify-between gap-2 text-slate-800"
              >
                <span className="font-medium">{entry.label}</span>
                <span className="flex-1 border-b border-dotted border-slate-300 mx-2" />
                <span className="font-semibold text-[0.88em] text-slate-700 whitespace-nowrap">
                  Trang {entry.pageNumber}
                </span>
              </li>
            ))}
          </ul>
        </nav>
      );

    case 'metadata':
      return (
        <section key={block.id} className="mb-4">
          <h3
            className="text-[1.12em] font-bold pl-2.5 mb-2"
            style={{ color: theme.primary, borderLeft: `3.5px solid ${theme.primary}` }}
          >
            I. Thông tin chung cuộc họp
          </h3>
          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-md p-2.5 text-[0.92em] border"
            style={{ backgroundColor: theme.soft, borderColor: theme.border }}
          >
            <div>
              <strong>Đơn vị:</strong> {docModel.organizationName}
            </div>
            <div>
              <strong>Số hiệu:</strong> {docModel.documentCode}
            </div>
            <div>
              <strong>Ngày họp:</strong> {docModel.createdAtLabel}
            </div>
            <div>
              <strong>Thời lượng:</strong> {docModel.durationLabel}
            </div>
            <div className="sm:col-span-2">
              <strong>Thành phần tham dự:</strong> {docModel.participants?.join(', ') || '—'}
            </div>
          </div>
        </section>
      );

    case 'section_heading':
      return (
        <h3
          key={block.id}
          className="text-[1.12em] font-bold pl-2.5 mt-3 mb-2"
          style={{ color: theme.primary, borderLeft: `3.5px solid ${theme.primary}` }}
        >
          {block.title}
        </h3>
      );

    case 'empty':
      return (
        <p key={block.id} className="text-[0.92em] italic text-slate-500 mb-3">
          {block.text}
        </p>
      );

    case 'summary_item':
      return (
        <div
          key={block.id}
          className="rounded border border-slate-200 bg-slate-50/70 p-2.5 mb-2"
        >
          <div className="font-bold text-slate-900 mb-0.5">
            {block.item.heading || `Mục ${block.index + 1}`}
          </div>
          <p className="text-slate-700">{block.item.content}</p>
        </div>
      );

    case 'tasks_table':
      return (
        <div key={block.id} className="mb-3 overflow-x-auto">
          {block.isContinuation && (
            <div className="text-[0.82em] italic text-slate-500 mb-1">
              (Tiếp theo bảng Action Items)
            </div>
          )}
          <table className="w-full border-collapse text-[0.9em]">
            <thead>
              <tr style={{ backgroundColor: theme.primary }} className="text-white">
                <th className="p-1.5 text-center border border-slate-300 w-7">#</th>
                <th className="p-1.5 text-left border border-slate-300">Nội dung công việc</th>
                <th className="p-1.5 text-left border border-slate-300 w-24">Thực hiện</th>
                <th className="p-1.5 text-left border border-slate-300 w-24">Phụ trách</th>
                <th className="p-1.5 text-left border border-slate-300 w-20">Hạn chót</th>
                {config.includeTimestamps && (
                  <th className="p-1.5 text-center border border-slate-300 w-12">TG</th>
                )}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((task, idx) => (
                <tr key={idx} className="even:bg-slate-50">
                  <td className="p-1.5 text-center border border-slate-300 font-semibold">
                    {task.task_index ?? idx + 1}
                  </td>
                  <td className="p-1.5 border border-slate-300 text-slate-800">{task.content}</td>
                  <td className="p-1.5 border border-slate-300 text-slate-700">
                    {task.assignee || '—'}
                  </td>
                  <td className="p-1.5 border border-slate-300 text-slate-700">
                    {task.responsible || '—'}
                  </td>
                  <td className="p-1.5 border border-slate-300 text-slate-700 whitespace-nowrap">
                    {task.deadline || '—'}
                  </td>
                  {config.includeTimestamps && (
                    <td className="p-1.5 text-center border border-slate-300 font-mono text-[0.88em] text-slate-600">
                      {task.timestamp || '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'ocr_item':
      return (
        <div key={block.id} className="rounded border border-slate-200 bg-slate-50 p-2.5 mb-2">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <strong className="text-slate-900">
              {block.index + 1}. {block.slide.slide_title}
            </strong>
            {config.includeTimestamps && block.slide.timestamp && (
              <span
                className="text-[0.84em] font-mono px-1.5 py-0.5 rounded font-semibold"
                style={{ backgroundColor: theme.soft, color: theme.primary }}
              >
                {block.slide.timestamp}
              </span>
            )}
          </div>
          <p className="font-mono text-[0.9em] text-slate-700">{block.slide.raw_text}</p>
        </div>
      );

    case 'transcript_item':
      return (
        <div key={block.id} className="py-1.5 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-bold" style={{ color: theme.primary }}>
              {block.entry.speakerName}
            </span>
            {config.includeTimestamps && (
              <span className="font-mono text-[0.86em] text-slate-500">
                [{block.entry.timeStart} - {block.entry.timeEnd}]
              </span>
            )}
            {block.entry.edited && (
              <span className="text-[0.78em] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-medium">
                Đã sửa
              </span>
            )}
          </div>
          <p className="text-slate-700">{block.entry.text}</p>
        </div>
      );

    case 'review_note':
      return (
        <div
          key={block.id}
          className="mt-4 rounded-md border p-3"
          style={{ backgroundColor: theme.soft, borderColor: theme.border }}
        >
          <div className="font-bold text-[0.95em] mb-1" style={{ color: theme.primary }}>
            Ghi chú &amp; Phê duyệt trước khi phát hành
          </div>
          <p className="text-slate-800 whitespace-pre-wrap">{block.note}</p>
        </div>
      );

    case 'signature_block':
      return (
        <div
          key={block.id}
          className="mt-6 pt-4 border-t border-slate-200 grid grid-cols-2 gap-6 text-center text-[0.9em]"
        >
          <div>
            <div className="font-bold uppercase text-slate-800">Người lập biên bản</div>
            <div className="text-[0.85em] italic text-slate-500">(Ký và ghi rõ họ tên)</div>
            <div className="mt-10 font-semibold text-slate-900">{docModel.authorName}</div>
          </div>
          <div>
            <div className="font-bold uppercase text-slate-800">Đại diện phê duyệt</div>
            <div className="text-[0.85em] italic text-slate-500">(Ký và ghi rõ họ tên)</div>
            <div className="mt-10 font-semibold text-slate-900">{docModel.recipientGroup}</div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

export default function DocxLivePreview({
  docModel: providedDocModel,
  meeting,
  speakers = [],
  speakerNameMap,
  summaryList,
  tasks,
  ocrSlides,
  config = DEFAULT_EXPORT_CONFIG,
  wordOptions: controlledWordOptions,
  onWordOptionsChange,
  onDownloadDocx,
  hideDownloadButton = false,
}) {
  const [internalWordOptions, setInternalWordOptions] = useState(DEFAULT_WORD_OPTIONS);
  const [zoom, setZoom] = useState(0.88);
  const [noteOpen, setNoteOpen] = useState(false);

  const wordOptions = controlledWordOptions ?? internalWordOptions;

  const updateWordOptions = (patch) => {
    const next = { ...wordOptions, ...patch };
    if (typeof onWordOptionsChange === 'function') {
      onWordOptionsChange(next);
    } else {
      setInternalWordOptions(next);
    }
  };

  const docModel = useMemo(() => {
    if (providedDocModel) return providedDocModel;
    return buildExportDocumentModel({
      meeting,
      speakers,
      speakerNameMap,
      summaryList,
      tasks,
      ocrSlides,
      config,
    });
  }, [providedDocModel, meeting, speakers, speakerNameMap, summaryList, tasks, ocrSlides, config]);

  const theme = useMemo(
    () => ACCENT_THEMES.find((t) => t.id === config?.accentTheme) || ACCENT_THEMES[0],
    [config?.accentTheme]
  );

  const font = resolveWordFont(wordOptions.fontFamily);
  const margin = resolveWordMargin(wordOptions.marginPreset);

  const pages = useMemo(
    () => paginateWordBlocks(docModel, wordOptions, config),
    [docModel, wordOptions, config]
  );

  const scaledWidthPx = Math.round(740 * zoom);
  const scaledMarginPx = Math.round(margin.px * zoom);
  const scaledFontPx = Math.round((Number(wordOptions.fontSizePt) || 11) * 1.18 * zoom);

  const handleDownload = () => {
    if (typeof onDownloadDocx === 'function') {
      onDownloadDocx(docModel, wordOptions);
      return;
    }
    downloadDocxFile(docModel, wordOptions, config);
  };

  return (
    <div
      aria-label="Word Live Preview Container"
      className="flex flex-col h-full bg-[#090f1d] rounded-2xl overflow-hidden"
    >
      {/* Word Mini-Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-[#0b1325] border-b border-[#18233c] text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={wordOptions.fontFamily}
            onChange={(e) => updateWordOptions({ fontFamily: e.target.value })}
            aria-label="Font chữ file Word"
            className="px-2 py-1 rounded-lg bg-[#0c1428] border border-[#1e2d50] text-slate-200 focus:outline-none focus:border-[#38bdf8]"
          >
            {WORD_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            value={wordOptions.fontSizePt}
            onChange={(e) => updateWordOptions({ fontSizePt: Number(e.target.value) })}
            aria-label="Cỡ chữ Word"
            className="px-2 py-1 rounded-lg bg-[#0c1428] border border-[#1e2d50] text-slate-200 focus:outline-none focus:border-[#38bdf8]"
          >
            {WORD_FONT_SIZES.map((pt) => (
              <option key={pt} value={pt}>
                {pt} pt
              </option>
            ))}
          </select>

          <select
            value={wordOptions.marginPreset}
            onChange={(e) => updateWordOptions({ marginPreset: e.target.value })}
            aria-label="Canh lề trang Word"
            className="px-2 py-1 rounded-lg bg-[#0c1428] border border-[#1e2d50] text-slate-200 focus:outline-none focus:border-[#38bdf8]"
          >
            {WORD_MARGIN_PRESETS.map((m) => (
              <option key={m.id} value={m.id}>
                Lề: {m.label}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-lg bg-[#0c1428] border border-[#1e2d50] p-0.5">
            {WORD_LINE_SPACINGS.map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => updateWordOptions({ lineSpacing: sp })}
                className={`px-2 py-0.5 rounded font-medium transition ${
                  wordOptions.lineSpacing === sp
                    ? 'bg-[#2563eb] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: 'showCoverPage', label: 'Trang bìa' },
            { key: 'showToc', label: 'Mục lục' },
            { key: 'showRuler', label: 'Thước' },
            { key: 'showHeaderFooter', label: 'Đánh trang' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => updateWordOptions({ [item.key]: !wordOptions[item.key] })}
              className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition ${
                wordOptions[item.key] !== false
                  ? 'bg-[#13203d] border-[#38bdf8]/60 text-[#38bdf8]'
                  : 'bg-[#0c1428] border-[#1e2d50] text-slate-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setNoteOpen((prev) => !prev)}
            className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition ${
              noteOpen || wordOptions.reviewNote
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                : 'bg-[#0c1428] border-[#1e2d50] text-slate-400 hover:text-white'
            }`}
          >
            + Ghi chú duyệt
          </button>

          <div className="inline-flex items-center gap-0.5 bg-[#0c1428] border border-[#1e2d50] rounded-lg px-1 py-0.5">
            {[0.75, 0.88, 1].map((scale) => (
              <button
                key={scale}
                type="button"
                onClick={() => setZoom(scale)}
                className={`px-1.5 py-0.5 rounded font-semibold transition ${
                  zoom === scale ? 'bg-[#13203d] text-[#38bdf8]' : 'text-slate-400 hover:text-white'
                }`}
              >
                {Math.round(scale * 100)}%
              </button>
            ))}
          </div>

          {!hideDownloadButton && (
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1 rounded-lg bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-semibold shadow-sm transition"
            >
              Tải .docx ({pages.length} trang)
            </button>
          )}
        </div>
      </div>

      {/* Inline Review Note Drawer before Downloading */}
      {noteOpen && (
        <div className="px-4 py-2.5 bg-[#0a1120] border-b border-[#18233c] flex flex-col gap-1.5 text-xs">
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span>Ghi chú ký duyệt / kết luận bổ sung (sẽ chèn vào cuối file .docx)</span>
            {wordOptions.reviewNote && (
              <button
                type="button"
                onClick={() => updateWordOptions({ reviewNote: '' })}
                className="text-rose-300 hover:text-rose-200"
              >
                Xóa ghi chú
              </button>
            )}
          </div>
          <textarea
            rows={2}
            value={wordOptions.reviewNote || ''}
            onChange={(e) => updateWordOptions({ reviewNote: e.target.value })}
            placeholder="Ví dụ: Đã rà soát biên bản Sprint Review — đồng ý phát hành chính thức tới các nhóm."
            className="w-full rounded-lg bg-[#070c18] border border-[#1e2d50] px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
          />
        </div>
      )}

      {/* Paginated A4 Word Viewport */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 bg-[#060a14]">
        {wordOptions.showRuler && (
          <WordRuler widthPx={scaledWidthPx} marginPx={scaledMarginPx} />
        )}

        <div className="flex flex-col items-center gap-6">
          {pages.map((page) => (
            <article
              key={page.pageNumber}
              aria-label={page.isCoverPage ? 'Word Cover Page' : `Word Page ${page.pageNumber}`}
              style={{
                width: `${scaledWidthPx}px`,
                minHeight: `${Math.round(1046 * zoom)}px`,
                padding: `${scaledMarginPx}px`,
                fontFamily: font.css,
                fontSize: `${scaledFontPx}px`,
                lineHeight: wordOptions.lineSpacing,
              }}
              className="bg-white text-slate-900 rounded-md shadow-2xl border border-slate-300 flex flex-col justify-between transition-all"
            >
              <div className={page.isCoverPage ? 'flex-1 flex flex-col' : ''}>
                {wordOptions.showHeaderFooter && !page.isCoverPage && page.pageNumber > 1 && (
                  <div className="pb-2 mb-3 border-b border-slate-200 flex items-center justify-between text-[0.78em] text-slate-400">
                    <span className="truncate max-w-[65%]">{docModel.title}</span>
                    <span>
                      {docModel.organizationName} · {docModel.documentCode}
                    </span>
                  </div>
                )}

                {page.blocks.map((block) =>
                  renderWordBlock(block, { docModel, config, theme })
                )}
              </div>

              {wordOptions.showHeaderFooter && !page.isCoverPage && (
                <footer className="pt-3 mt-6 border-t border-slate-200 flex items-center justify-between text-[0.82em] text-slate-500">
                  <span>
                    {config.includeWatermark
                      ? `SmartRec AI Workspace · ${docModel.documentCode}`
                      : docModel.organizationName}
                  </span>
                  <span className="font-semibold text-slate-600">
                    Trang {page.pageNumber} / {pages.length}
                  </span>
                </footer>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
