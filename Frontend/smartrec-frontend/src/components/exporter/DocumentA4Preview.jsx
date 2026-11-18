import React, { useMemo, useState } from 'react';
import {
  ACCENT_THEMES,
  generateExportJson,
  generateMarkdown,
} from '../../services/documentExporterService';

export default function DocumentA4Preview({ docModel, config }) {
  const [viewMode, setViewMode] = useState('a4');
  const [zoom, setZoom] = useState(0.9);

  const sections = config.sections || {};
  const theme = useMemo(
    () => ACCENT_THEMES.find((t) => t.id === config.accentTheme) || ACCENT_THEMES[0],
    [config.accentTheme]
  );

  const markdownSource = useMemo(() => {
    if (viewMode !== 'markdown') return '';
    return generateMarkdown(docModel, config);
  }, [viewMode, docModel, config]);

  const jsonSource = useMemo(() => {
    if (viewMode !== 'json') return '';
    return generateExportJson(docModel, config);
  }, [viewMode, docModel, config]);

  const noSectionsSelected = !Object.values(sections).some(Boolean);

  return (
    <div className="flex flex-col h-full min-h-[540px] bg-[#090f1d] border border-[#1b2640] rounded-2xl overflow-hidden">
      {/* Preview Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#070c18] border-b border-[#18233c] shrink-0">
        <div className="inline-flex rounded-lg bg-[#0c1324] border border-[#1b2742] p-0.5 text-[11px]">
          {[
            { id: 'a4', label: 'Trang giấy A4' },
            { id: 'markdown', label: 'Markdown' },
            { id: 'json', label: 'JSON' },
          ].map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setViewMode(mode.id)}
              className={`px-3 py-1 rounded-md font-semibold transition ${
                viewMode === mode.id
                  ? 'bg-[#2563eb] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span>
            {docModel.stats.wordCount} từ · ~{docModel.stats.estimatedPages} trang A4
          </span>
          {viewMode === 'a4' && (
            <div className="inline-flex items-center gap-1 bg-[#0c1324] border border-[#1b2742] rounded-lg px-1.5 py-0.5">
              {[0.75, 0.9, 1].map((scale) => (
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
          )}
        </div>
      </div>

      {/* Preview Body */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 bg-[#060a14]">
        {noSectionsSelected ? (
          <div className="h-full min-h-[360px] flex items-center justify-center text-xs text-slate-400 border border-dashed border-[#1e2c4d] rounded-xl p-6 text-center">
            Hãy bật ít nhất một thành phần nội dung ở cột bên trái để xem trước tài liệu.
          </div>
        ) : viewMode === 'markdown' ? (
          <pre className="w-full rounded-xl border border-[#1b2742] bg-[#0b1222] p-4 text-xs text-slate-200 font-mono whitespace-pre-wrap leading-relaxed">
            {markdownSource}
          </pre>
        ) : viewMode === 'json' ? (
          <pre className="w-full rounded-xl border border-[#1b2742] bg-[#0b1222] p-4 text-xs text-sky-200 font-mono whitespace-pre-wrap leading-relaxed">
            {jsonSource}
          </pre>
        ) : (
          <div className="flex justify-center">
            <article
              aria-label="Live A4 Document Preview"
              style={{
                width: `${Math.round(740 * zoom)}px`,
                fontSize: `${Math.round(13 * zoom)}px`,
              }}
              className="bg-white text-slate-900 rounded-xl shadow-2xl border border-slate-200 p-6 sm:p-8 transition-all"
            >
              {/* Header */}
              <header
                className="pb-3 mb-4"
                style={{ borderBottom: `3px solid ${theme.primary}` }}
              >
                <div
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: theme.primary }}
                >
                  {docModel.organizationName} · Meeting Minutes
                </div>
                <h2 className="text-xl font-bold text-slate-900 mt-1 break-words">
                  {docModel.title}
                </h2>
              </header>

              {/* Metadata Grid */}
              {sections.metadata && (
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg p-3 mb-5 text-xs border"
                  style={{ backgroundColor: theme.soft, borderColor: theme.border }}
                >
                  <div>
                    <strong className="text-slate-700">Đơn vị:</strong>{' '}
                    <span className="text-slate-900">{docModel.organizationName}</span>
                  </div>
                  <div>
                    <strong className="text-slate-700">Người lập:</strong>{' '}
                    <span className="text-slate-900">{docModel.authorName}</span>
                  </div>
                  <div>
                    <strong className="text-slate-700">Ngày cuộc họp:</strong>{' '}
                    <span className="text-slate-900">{docModel.createdAtLabel}</span>
                  </div>
                  <div>
                    <strong className="text-slate-700">Thời lượng:</strong>{' '}
                    <span className="text-slate-900">{docModel.durationLabel}</span>
                  </div>
                  <div className="sm:col-span-2">
                    <strong className="text-slate-700">Thành phần tham gia:</strong>{' '}
                    <span className="text-slate-900">
                      {docModel.participants.join(', ') || '—'}
                    </span>
                  </div>
                </div>
              )}

              {/* AI Summary */}
              {sections.summary && (
                <section className="mb-5">
                  <h3
                    className="text-sm font-bold pl-2.5 mb-2.5"
                    style={{
                      color: theme.primary,
                      borderLeft: `4px solid ${theme.primary}`,
                    }}
                  >
                    Tóm tắt điều hành (AI Summary)
                  </h3>
                  <div className="flex flex-col gap-2">
                    {docModel.summary.length === 0 ? (
                      <p className="text-xs italic text-slate-500">Chưa có nội dung tóm tắt.</p>
                    ) : (
                      docModel.summary.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg border border-slate-200 bg-slate-50/80 p-3"
                        >
                          <div className="text-xs font-bold text-slate-900 mb-1">
                            {item.heading || `Mục ${idx + 1}`}
                          </div>
                          <p className="text-xs text-slate-700 leading-relaxed">{item.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )}

              {/* Action Items Table */}
              {sections.tasks && (
                <section className="mb-5">
                  <h3
                    className="text-sm font-bold pl-2.5 mb-2.5"
                    style={{
                      color: theme.primary,
                      borderLeft: `4px solid ${theme.primary}`,
                    }}
                  >
                    Bảng Action Items &amp; Phân công ({docModel.tasks.length})
                  </h3>
                  {docModel.tasks.length === 0 ? (
                    <p className="text-xs italic text-slate-500">Chưa có công việc nào.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr style={{ backgroundColor: theme.primary }} className="text-white">
                            <th className="p-2 text-center border border-slate-300 w-8">#</th>
                            <th className="p-2 text-left border border-slate-300">Công việc</th>
                            <th className="p-2 text-left border border-slate-300 w-24">Thực hiện</th>
                            <th className="p-2 text-left border border-slate-300 w-24">Phụ trách</th>
                            <th className="p-2 text-left border border-slate-300 w-20">Hạn chót</th>
                            {config.includeTimestamps && (
                              <th className="p-2 text-center border border-slate-300 w-14">TG</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {docModel.tasks.map((task, idx) => (
                            <tr key={idx} className="even:bg-slate-50">
                              <td className="p-2 text-center border border-slate-300 font-semibold">
                                {task.task_index ?? idx + 1}
                              </td>
                              <td className="p-2 border border-slate-300 text-slate-800">
                                {task.content}
                              </td>
                              <td className="p-2 border border-slate-300 text-slate-700">
                                {task.assignee || '—'}
                              </td>
                              <td className="p-2 border border-slate-300 text-slate-700">
                                {task.responsible || '—'}
                              </td>
                              <td className="p-2 border border-slate-300 text-slate-700 whitespace-nowrap">
                                {task.deadline || '—'}
                              </td>
                              {config.includeTimestamps && (
                                <td className="p-2 text-center border border-slate-300 font-mono text-[11px] text-slate-600">
                                  {task.timestamp || '—'}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {/* OCR Slides */}
              {sections.ocr && docModel.ocrSlides.length > 0 && (
                <section className="mb-5">
                  <h3
                    className="text-sm font-bold pl-2.5 mb-2.5"
                    style={{
                      color: theme.primary,
                      borderLeft: `4px solid ${theme.primary}`,
                    }}
                  >
                    Slide Keyframes &amp; OCR ({docModel.ocrSlides.length})
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    {docModel.ocrSlides.map((slide, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <strong className="text-xs text-slate-900">
                            {idx + 1}. {slide.slide_title}
                          </strong>
                          {config.includeTimestamps && slide.timestamp && (
                            <span
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold"
                              style={{ backgroundColor: theme.soft, color: theme.primary }}
                            >
                              {slide.timestamp}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-700 font-mono">{slide.raw_text}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Transcript */}
              {sections.transcript && (
                <section className="mb-4">
                  <h3
                    className="text-sm font-bold pl-2.5 mb-2.5"
                    style={{
                      color: theme.primary,
                      borderLeft: `4px solid ${theme.primary}`,
                    }}
                  >
                    Transcript chi tiết ({docModel.transcript.length} đoạn)
                  </h3>
                  <div className="flex flex-col divide-y divide-slate-100">
                    {docModel.transcript.map((entry) => (
                      <div key={entry.chunkKey} className="py-2 text-xs">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold" style={{ color: theme.primary }}>
                            {entry.speakerName}
                          </span>
                          {config.includeTimestamps && (
                            <span className="font-mono text-[11px] text-slate-500">
                              [{entry.timeStart} - {entry.timeEnd}]
                            </span>
                          )}
                          {entry.edited && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-medium">
                              Đã sửa
                            </span>
                          )}
                        </div>
                        <p className="text-slate-700 leading-relaxed">{entry.text}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {config.includeWatermark && (
                <footer className="mt-6 pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Generated by SmartRec AI Workspace</span>
                  <span>{docModel.exportedAtLabel}</span>
                </footer>
              )}
            </article>
          </div>
        )}
      </div>
    </div>
  );
}

