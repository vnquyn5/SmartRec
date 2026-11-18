import mockSummaryData from '../mocks/mock_summary.json';
import mockSttData from '../mocks/mock_stt.json';
import mockOcrData from '../mocks/mock_ocr.json';
import {
  loadMeetingTasks,
  loadSpeakerNameOverrides,
  loadTranscriptOverrides,
} from './meetingReviewService.js';
import { formatTimestamp, parseTimeToSeconds } from '../utils/timeFormat.js';

export const EXPORT_TEMPLATES = [
  {
    id: 'executive',
    label: 'Biên bản chuẩn (Executive)',
    description: 'Cân đối giữa Tóm tắt AI, Quyết định & Bảng Action Items.',
    sections: {
      metadata: true,
      summary: true,
      tasks: true,
      ocr: true,
      transcript: false,
    },
  },
  {
    id: 'action_items',
    label: 'Báo cáo Action Items',
    description: 'Tập trung tối đa vào đầu việc, người phụ trách và deadline.',
    sections: {
      metadata: true,
      summary: false,
      tasks: true,
      ocr: false,
      transcript: false,
    },
  },
  {
    id: 'full_archive',
    label: 'Hồ sơ đầy đủ (Full Archive)',
    description: 'Xuất trọn vẹn Tóm tắt, Tasks, Slide OCR và Transcript chi tiết.',
    sections: {
      metadata: true,
      summary: true,
      tasks: true,
      ocr: true,
      transcript: true,
    },
  },
];

export const EXPORT_FORMATS = [
  { id: 'docx', label: 'Word (.docx)', ext: 'docx', badge: 'OOXML Word' },
  { id: 'pdf', label: 'In / PDF (A4)', ext: 'pdf', badge: 'A4 Vector' },
  { id: 'md', label: 'Markdown (.md)', ext: 'md', badge: 'Notion / Git' },
  { id: 'html', label: 'Web HTML (.html)', ext: 'html', badge: 'Standalone' },
  { id: 'json', label: 'JSON (.json)', ext: 'json', badge: 'Structured' },
];

export const ACCENT_THEMES = [
  { id: 'blue', label: 'SmartRec Blue', primary: '#1d4ed8', soft: '#eff6ff', border: '#bfdbfe' },
  { id: 'slate', label: 'Executive Ink', primary: '#0f172a', soft: '#f8fafc', border: '#cbd5e1' },
  { id: 'emerald', label: 'Emerald Audit', primary: '#047857', soft: '#ecfdf5', border: '#a7f3d0' },
];

export const DEFAULT_EXPORT_CONFIG = {
  templateId: 'executive',
  format: 'pdf',
  accentTheme: 'blue',
  documentTitle: '',
  documentCode: '',
  documentSubtitle: 'Biên bản cuộc họp & Báo cáo phân tích AI',
  authorName: '',
  organizationName: 'SmartRec AI Workspace',
  recipientGroup: 'Ban Giám đốc & Thành viên dự án',
  meetingLocation: 'SmartRec Online Workspace',
  includeCoverPage: true,
  includeToc: true,
  includeTimestamps: true,
  includeWatermark: true,
  includeEmptyFields: false,
  sections: {
    metadata: true,
    summary: true,
    tasks: true,
    ocr: true,
    transcript: false,
  },
};

export function getSmartRecLogoSvg(size = 36) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="SmartRec Logo">
  <defs>
    <linearGradient id="smartrecGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#00d1ff"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#smartrecGrad)"/>
  <circle cx="20" cy="20" r="7.5" fill="rgba(255,255,255,0.22)" stroke="#ffffff" stroke-width="2.5"/>
</svg>`;
}

export function getPresetConfig(templateId, currentConfig = DEFAULT_EXPORT_CONFIG) {
  const preset = EXPORT_TEMPLATES.find((t) => t.id === templateId) || EXPORT_TEMPLATES[0];
  return {
    ...currentConfig,
    templateId: preset.id,
    sections: { ...preset.sections },
  };
}

export function groupSpeakerSegments(segments = []) {
  const grouped = new Map();
  segments.forEach((segment) => {
    if (
      !segment ||
      !Number.isFinite(Number(segment.startTime)) ||
      !Number.isFinite(Number(segment.endTime))
    ) {
      return;
    }
    const label = segment.speakerLabel || 'Speaker';
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push({
      startSeconds: Number(segment.startTime),
      endSeconds: Number(segment.endTime),
      text: segment.text || segment.transcript || '',
    });
  });

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([label, items]) => ({
      id: label,
      originalLabel: label,
      name: label,
      segments: items
        .sort((a, b) => a.startSeconds - b.startSeconds)
        .map(({ startSeconds, endSeconds, text }) => ({
          startSeconds,
          endSeconds,
          start: formatTimestamp(startSeconds),
          end: formatTimestamp(endSeconds),
          text,
        })),
    }));
}

function makeUniqueChunkKey(baseKey, seenCounts) {
  const count = (seenCounts.get(baseKey) || 0) + 1;
  seenCounts.set(baseKey, count);
  return count === 1 ? baseKey : `${baseKey}#${count}`;
}

function formatDurationLabel(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDateDisplay(value) {
  if (!value) {
    return new Date().toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildResolvedTranscript({ meetingId, speakers = [], speakerNameMap = {} }) {
  const overrides = loadTranscriptOverrides(meetingId);
  const rawList = Array.isArray(mockSttData)
    ? mockSttData
    : mockSttData?.mock_stt || [];
  const seenCounts = new Map();

  if (Array.isArray(speakers) && speakers.length > 0) {
    return speakers
      .flatMap((spk) =>
        (spk.segments || []).map((seg) => ({
          speakerId: spk.id,
          speakerName:
            speakerNameMap[spk.id] || spk.name || spk.originalLabel || spk.id,
          timeStart: seg.start || formatTimestamp(seg.startSeconds || 0),
          timeEnd: seg.end || formatTimestamp(seg.endSeconds || 0),
          seconds: Number(seg.startSeconds) || 0,
          baseChunkKey: `${spk.id}-${seg.startSeconds}-${seg.endSeconds}`,
          rawText: seg.text || '',
        }))
      )
      .sort((a, b) => a.seconds - b.seconds)
      .map((chunk, index) => {
        const fallbackItem = rawList[index % Math.max(1, rawList.length)];
        const chunkKey = makeUniqueChunkKey(chunk.baseChunkKey, seenCounts);
        const originalText = chunk.rawText || fallbackItem?.text || '';
        const text =
          overrides[chunkKey] !== undefined ? overrides[chunkKey] : originalText;
        return {
          id: index + 1,
          chunkKey,
          speakerId: chunk.speakerId,
          speakerName:
            speakerNameMap[chunk.speakerId] ||
            chunk.speakerName ||
            fallbackItem?.speaker_name_temp ||
            chunk.speakerId,
          timeStart: chunk.timeStart,
          timeEnd: chunk.timeEnd,
          text: String(text || '').trim(),
          edited: overrides[chunkKey] !== undefined,
        };
      });
  }

  return rawList.map((item, index) => {
    const speakerId = item.speaker_id || `Speaker ${(index % 3) + 1}`;
    const baseKey = `${item.speaker_id || index}-${item.timestamp_start}-${item.timestamp_end}`;
    const chunkKey = makeUniqueChunkKey(baseKey, seenCounts);
    const originalText = item.text || '';
    const text = overrides[chunkKey] !== undefined ? overrides[chunkKey] : originalText;
    return {
      id: index + 1,
      chunkKey,
      speakerId,
      speakerName:
        speakerNameMap[speakerId] || item.speaker_name_temp || speakerId,
      timeStart: item.timestamp_start || '00:00',
      timeEnd: item.timestamp_end || '00:05',
      seconds: parseTimeToSeconds(item.timestamp_start),
      text: String(text || '').trim(),
      edited: overrides[chunkKey] !== undefined,
    };
  });
}

export function buildExportDocumentModel({
  meeting,
  speakers = [],
  speakerNameMap: providedSpeakerMap,
  summaryList,
  tasks,
  ocrSlides,
  config = DEFAULT_EXPORT_CONFIG,
} = {}) {
  const meetingId = meeting?.id || 'demo-meeting';
  const storedSpeakerMap = loadSpeakerNameOverrides(meetingId);
  const mergedSpeakerMap = {
    ...storedSpeakerMap,
    ...(providedSpeakerMap || {}),
  };

  const resolvedTitle =
    String(config.documentTitle || '').trim() ||
    meeting?.fileName ||
    meeting?.title ||
    'Q4_Product_Roadmap_Review_Meeting';

  const resolvedSummary = Array.isArray(summaryList)
    ? summaryList
    : mockSummaryData?.summary || [];

  const resolvedTasks = Array.isArray(tasks)
    ? tasks
    : loadMeetingTasks(meetingId, mockSummaryData?.task || []);

  const resolvedOcr = Array.isArray(ocrSlides)
    ? ocrSlides
    : Array.isArray(mockOcrData)
      ? mockOcrData
      : [];

  const resolvedTranscript = buildResolvedTranscript({
    meetingId,
    speakers,
    speakerNameMap: mergedSpeakerMap,
  });

  const uniqueSpeakers = Array.from(
    new Set(resolvedTranscript.map((item) => item.speakerName).filter(Boolean))
  );

  const sections = config.sections || DEFAULT_EXPORT_CONFIG.sections;
  const wordParts = [resolvedTitle];
  if (sections.summary) {
    resolvedSummary.forEach((s) => wordParts.push(s.heading || '', s.content || ''));
  }
  if (sections.tasks) {
    resolvedTasks.forEach((t) =>
      wordParts.push(t.content || '', t.assignee || '', t.responsible || '')
    );
  }
  if (sections.ocr) {
    resolvedOcr.forEach((o) => wordParts.push(o.slide_title || '', o.raw_text || ''));
  }
  if (sections.transcript) {
    resolvedTranscript.forEach((tr) => wordParts.push(tr.speakerName || '', tr.text || ''));
  }
  const wordCount = wordParts
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const rawCode = String(config.documentCode || '').trim();
  const dateObj = meeting?.createdAt ? new Date(meeting.createdAt) : new Date();
  const year = Number.isNaN(dateObj.getTime()) ? new Date().getFullYear() : dateObj.getFullYear();
  const month = String(
    (Number.isNaN(dateObj.getTime()) ? new Date().getMonth() : dateObj.getMonth()) + 1
  ).padStart(2, '0');
  const shortId = String(meetingId || 'SR').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '0001';
  const documentCode = rawCode || `BBH-${year}/${month}-${shortId}`;

  const tocItems = [];
  if (sections.metadata) {
    tocItems.push({ key: 'metadata', number: 'I', label: 'Thông tin chung cuộc họp' });
  }
  let secNum = 1;
  if (sections.summary) {
    tocItems.push({
      key: 'summary',
      number: String(secNum++),
      label: 'Tóm tắt điều hành (AI Summary)',
    });
  }
  if (sections.tasks) {
    tocItems.push({
      key: 'tasks',
      number: String(secNum++),
      label: `Bảng Action Items & Phân công (${resolvedTasks.length})`,
    });
  }
  if (sections.ocr && resolvedOcr.length > 0) {
    tocItems.push({
      key: 'ocr',
      number: String(secNum++),
      label: `Nội dung Slide & OCR Keyframes (${resolvedOcr.length})`,
    });
  }
  if (sections.transcript && resolvedTranscript.length > 0) {
    tocItems.push({
      key: 'transcript',
      number: String(secNum++),
      label: `Transcript chi tiết cuộc họp (${resolvedTranscript.length} đoạn)`,
    });
  }

  return {
    meetingId,
    documentCode,
    documentSubtitle:
      String(config.documentSubtitle || '').trim() ||
      'Biên bản cuộc họp & Báo cáo phân tích AI',
    recipientGroup:
      String(config.recipientGroup || '').trim() ||
      'Ban Giám đốc & Thành viên dự án',
    meetingLocation:
      String(config.meetingLocation || '').trim() ||
      'SmartRec Online Workspace',
    title: resolvedTitle,
    organizationName: config.organizationName || 'SmartRec AI Workspace',
    authorName: config.authorName || 'Thư ký AI · SmartRec',
    createdAtLabel: formatDateDisplay(meeting?.createdAt),
    exportedAtLabel: formatDateDisplay(new Date().toISOString()),
    durationLabel: formatDurationLabel(meeting?.durationSeconds ?? 2700),
    statusLabel: String(meeting?.status || 'COMPLETED').toUpperCase(),
    participants: uniqueSpeakers,
    summary: resolvedSummary,
    tasks: resolvedTasks,
    ocrSlides: resolvedOcr,
    transcript: resolvedTranscript,
    tocItems,
    stats: {
      wordCount,
      estimatedPages: Math.max(1, Math.ceil(wordCount / 360)) + (config.includeCoverPage !== false ? 1 : 0),
      summaryCount: resolvedSummary.length,
      taskCount: resolvedTasks.length,
      ocrCount: resolvedOcr.length,
      transcriptCount: resolvedTranscript.length,
      speakerCount: uniqueSpeakers.length,
    },
  };
}

export function generateMarkdown(docModel, config = DEFAULT_EXPORT_CONFIG) {
  const sections = config.sections || DEFAULT_EXPORT_CONFIG.sections;
  const lines = [];

  if (config.includeCoverPage !== false) {
    lines.push(`> **${docModel.organizationName}** · Số/Ký hiệu: \`${docModel.documentCode}\``);
    lines.push('');
    lines.push(`# ${docModel.title}`);
    lines.push(`**${docModel.documentSubtitle}**`);
    lines.push('');
    lines.push(`- **Kính gửi:** ${docModel.recipientGroup}`);
    lines.push(`- **Đơn vị ban hành:** ${docModel.organizationName}`);
    lines.push(`- **Người lập biên bản:** ${docModel.authorName}`);
    lines.push(`- **Ngày cuộc họp:** ${docModel.createdAtLabel}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  } else {
    lines.push(`# ${docModel.title}`);
    lines.push('');
  }

  if (config.includeToc !== false && docModel.tocItems?.length > 0) {
    lines.push('## Mục lục');
    docModel.tocItems.forEach((item) => {
      lines.push(`- **${item.number}.** ${item.label}`);
    });
    lines.push('');
  }

  if (sections.metadata) {
    lines.push('## Thông tin cuộc họp');
    lines.push(`- **Đơn vị / Workspace:** ${docModel.organizationName}`);
    lines.push(`- **Người lập báo cáo:** ${docModel.authorName}`);
    lines.push(`- **Ngày cuộc họp:** ${docModel.createdAtLabel}`);
    lines.push(`- **Thời lượng:** ${docModel.durationLabel}`);
    lines.push(`- **Trạng thái AI:** ${docModel.statusLabel}`);
    if (docModel.participants.length > 0) {
      lines.push(`- **Thành phần tham gia:** ${docModel.participants.join(', ')}`);
    }
    lines.push('');
  }

  if (sections.summary && docModel.summary.length > 0) {
    lines.push('## Tóm tắt điều hành (AI Summary)');
    docModel.summary.forEach((item) => {
      lines.push(`### ${item.heading || 'Nội dung chính'}`);
      lines.push(item.content || '');
      lines.push('');
    });
  }

  if (sections.tasks) {
    lines.push('## Danh sách công việc (Action Items)');
    if (docModel.tasks.length === 0) {
      lines.push('_Không có action item nào được ghi nhận._');
    } else {
      lines.push('| # | Nội dung công việc | Người thực hiện | Người chịu trách nhiệm | Hạn chót | Mốc thời gian |');
      lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
      docModel.tasks.forEach((task, idx) => {
        const num = task.task_index ?? idx + 1;
        const content = String(task.content || '').replace(/\|/g, '\\|');
        const assignee = task.assignee || (config.includeEmptyFields ? 'Chưa phân công' : '—');
        const responsible = task.responsible || (config.includeEmptyFields ? 'Chưa phân công' : '—');
        const deadline = task.deadline || '—';
        const ts = config.includeTimestamps ? task.timestamp || '—' : '—';
        lines.push(`| ${num} | ${content} | ${assignee} | ${responsible} | ${deadline} | ${ts} |`);
      });
    }
    lines.push('');
  }

  if (sections.ocr && docModel.ocrSlides.length > 0) {
    lines.push('## Nội dung Slide & OCR Keyframes');
    docModel.ocrSlides.forEach((slide, idx) => {
      const tsPrefix = config.includeTimestamps && slide.timestamp ? `[${slide.timestamp}] ` : '';
      lines.push(`### ${idx + 1}. ${tsPrefix}${slide.slide_title || 'Slide'}`);
      if (slide.raw_text) {
        lines.push(`> ${slide.raw_text}`);
      }
      if (Array.isArray(slide.tags) && slide.tags.length > 0) {
        lines.push(`- **Tags:** ${slide.tags.map((tag) => `\`${tag}\``).join(' ')}`);
      }
      lines.push('');
    });
  }

  if (sections.transcript && docModel.transcript.length > 0) {
    lines.push('## Transcript chi tiết');
    docModel.transcript.forEach((entry) => {
      const ts = config.includeTimestamps ? `[${entry.timeStart} - ${entry.timeEnd}] ` : '';
      lines.push(`- **${ts}${entry.speakerName}:** ${entry.text}`);
    });
    lines.push('');
  }

  if (config.includeWatermark) {
    lines.push('---');
    lines.push(`_Xuất từ SmartRec AI Engine lúc ${docModel.exportedAtLabel}_`);
  }

  return lines.join('\n');
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateDocumentHtml(docModel, config = DEFAULT_EXPORT_CONFIG, { forWord = false } = {}) {
  const sections = config.sections || DEFAULT_EXPORT_CONFIG.sections;
  const theme = ACCENT_THEMES.find((t) => t.id === config.accentTheme) || ACCENT_THEMES[0];

  const metadataHtml = sections.metadata
    ? `
      <table class="meta-table">
        <tr>
          <td><strong>Đơn vị:</strong> ${escapeHtml(docModel.organizationName)}</td>
          <td><strong>Người lập:</strong> ${escapeHtml(docModel.authorName)}</td>
        </tr>
        <tr>
          <td><strong>Ngày cuộc họp:</strong> ${escapeHtml(docModel.createdAtLabel)}</td>
          <td><strong>Thời lượng:</strong> ${escapeHtml(docModel.durationLabel)}</td>
        </tr>
        <tr>
          <td colspan="2"><strong>Thành phần tham gia:</strong> ${escapeHtml(
            docModel.participants.join(', ') || '—'
          )}</td>
        </tr>
      </table>`
    : '';

  const summaryHtml =
    sections.summary && docModel.summary.length > 0
      ? `
      <section class="section">
        <h2>1. Tóm tắt điều hành (AI Summary)</h2>
        ${docModel.summary
          .map(
            (item) => `
          <div class="summary-card">
            <h3>${escapeHtml(item.heading || 'Nội dung chính')}</h3>
            <p>${escapeHtml(item.content || '')}</p>
          </div>`
          )
          .join('')}
      </section>`
      : '';

  const tasksHtml = sections.tasks
    ? `
      <section class="section">
        <h2>${sections.summary ? '2. ' : ''}Bảng Action Items &amp; Phân công</h2>
        ${
          docModel.tasks.length === 0
            ? '<p class="muted">Không có đầu việc nào được ghi nhận.</p>'
            : `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:36px;">#</th>
                <th>Nội dung công việc</th>
                <th style="width:120px;">Thực hiện</th>
                <th style="width:120px;">Phụ trách</th>
                <th style="width:92px;">Hạn chót</th>
                ${config.includeTimestamps ? '<th style="width:70px;">Mốc TG</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${docModel.tasks
                .map(
                  (task, idx) => `
                <tr>
                  <td style="text-align:center;">${escapeHtml(task.task_index ?? idx + 1)}</td>
                  <td>${escapeHtml(task.content || '')}</td>
                  <td>${escapeHtml(task.assignee || '—')}</td>
                  <td>${escapeHtml(task.responsible || '—')}</td>
                  <td>${escapeHtml(task.deadline || '—')}</td>
                  ${
                    config.includeTimestamps
                      ? `<td style="text-align:center;font-family:monospace;">${escapeHtml(
                          task.timestamp || '—'
                        )}</td>`
                      : ''
                  }
                </tr>`
                )
                .join('')}
            </tbody>
          </table>`
        }
      </section>`
    : '';

  const ocrHtml =
    sections.ocr && docModel.ocrSlides.length > 0
      ? `
      <section class="section">
        <h2>Nội dung Slide &amp; OCR Keyframes</h2>
        ${docModel.ocrSlides
          .map(
            (slide, idx) => `
          <div class="ocr-card">
            <div class="ocr-head">
              <strong>${idx + 1}. ${escapeHtml(slide.slide_title || 'Slide')}</strong>
              ${
                config.includeTimestamps && slide.timestamp
                  ? `<span class="badge">${escapeHtml(slide.timestamp)}</span>`
                  : ''
              }
            </div>
            <p>${escapeHtml(slide.raw_text || '')}</p>
          </div>`
          )
          .join('')}
      </section>`
      : '';

  const transcriptHtml =
    sections.transcript && docModel.transcript.length > 0
      ? `
      <section class="section">
        <h2>Transcript chi tiết cuộc họp</h2>
        ${docModel.transcript
          .map(
            (entry) => `
          <div class="transcript-row">
            <span class="speaker">${escapeHtml(entry.speakerName)}</span>
            ${
              config.includeTimestamps
                ? `<span class="ts">[${escapeHtml(entry.timeStart)} - ${escapeHtml(entry.timeEnd)}]</span>`
                : ''
            }
            <p>${escapeHtml(entry.text)}</p>
          </div>`
          )
          .join('')}
      </section>`
      : '';

  const htmlAttrs = forWord
    ? 'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"'
    : 'lang="vi"';

  return `<!DOCTYPE html>
<html ${htmlAttrs}>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(docModel.title)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body {
      font-family: "Segoe UI", Arial, sans-serif;
      color: #0f172a;
      line-height: 1.55;
      font-size: 13px;
      margin: 0;
      padding: ${forWord ? '0' : '24px'};
      background: #ffffff;
    }
    .doc-container { max-width: 794px; margin: 0 auto; }
    .doc-header {
      border-bottom: 3px solid ${theme.primary};
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .doc-kicker {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: ${theme.primary};
      font-weight: 700;
    }
    h1 { margin: 4px 0 0; font-size: 22px; color: #0f172a; }
    h2 {
      font-size: 15px;
      color: ${theme.primary};
      border-left: 4px solid ${theme.primary};
      padding-left: 10px;
      margin: 20px 0 10px;
    }
    h3 { margin: 0 0 4px; font-size: 13.5px; color: #0f172a; }
    p { margin: 0; }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      background: ${theme.soft};
      border: 1px solid ${theme.border};
      margin-bottom: 16px;
      font-size: 12px;
    }
    .meta-table td { padding: 7px 10px; border: 1px solid ${theme.border}; }
    .summary-card, .ocr-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .ocr-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .badge {
      font-family: monospace;
      font-size: 11px;
      background: ${theme.soft};
      color: ${theme.primary};
      padding: 1px 6px;
      border-radius: 4px;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .data-table th {
      background: ${theme.primary};
      color: #ffffff;
      text-align: left;
      padding: 7px 8px;
      border: 1px solid ${theme.primary};
    }
    .data-table td {
      padding: 7px 8px;
      border: 1px solid #cbd5e1;
      vertical-align: top;
    }
    .transcript-row {
      padding: 7px 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .speaker { font-weight: 700; color: ${theme.primary}; margin-right: 6px; }
    .ts { font-family: monospace; font-size: 11px; color: #64748b; }
    .cover-page {
      border: 1.5px solid ${theme.border};
      padding: 32px;
      margin-bottom: 24px;
      background: #ffffff;
      page-break-after: always;
    }
    .cover-brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid ${theme.primary};
      padding-bottom: 14px;
      margin-bottom: 36px;
    }
    .cover-brand-left { display: flex; align-items: center; gap: 10px; }
    .cover-brand-name { font-size: 18px; font-weight: 800; color: #0f172a; }
    .cover-brand-name span { color: #0284c7; }
    .cover-hero {
      text-align: center;
      padding: 28px 16px;
      background: ${theme.soft};
      border-top: 3px solid ${theme.primary};
      border-bottom: 3px solid ${theme.primary};
      margin-bottom: 32px;
    }
    .toc-box {
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 18px;
    }
    .toc-item {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px dotted #cbd5e1;
      font-size: 12.5px;
    }
    .sig-grid {
      display: table;
      width: 100%;
      margin-top: 28px;
      border-top: 1px solid #e2e8f0;
      padding-top: 16px;
    }
    .sig-col { display: table-cell; width: 50%; text-align: center; vertical-align: top; }
    .doc-footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      font-size: 11px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
    }
    .muted { color: #64748b; font-style: italic; }
  </style>
</head>
<body>
  <div class="doc-container">
    ${
      config.includeCoverPage !== false
        ? `<section class="cover-page">
      <div class="cover-brand-row">
        <div class="cover-brand-left">
          ${getSmartRecLogoSvg(36)}
          <div>
            <div class="cover-brand-name">Smart<span>Rec</span></div>
            <div style="font-size:11px;color:#475569;">${escapeHtml(docModel.organizationName)}</div>
          </div>
        </div>
        <div style="text-align:right;font-size:11px;color:#475569;">
          <div><strong>Số/Ký hiệu:</strong> ${escapeHtml(docModel.documentCode)}</div>
          <div><strong>Ngày lập:</strong> ${escapeHtml(docModel.exportedAtLabel)}</div>
        </div>
      </div>
      <div class="cover-hero">
        <div class="doc-kicker">${escapeHtml(docModel.documentSubtitle)}</div>
        <h1 style="font-size:24px;margin-top:8px;">${escapeHtml(docModel.title)}</h1>
      </div>
      <table class="meta-table">
        <tr><td><strong>Kính gửi:</strong> ${escapeHtml(docModel.recipientGroup)}</td><td><strong>Địa điểm:</strong> ${escapeHtml(docModel.meetingLocation)}</td></tr>
        <tr><td><strong>Đơn vị chủ trì:</strong> ${escapeHtml(docModel.organizationName)}</td><td><strong>Người lập:</strong> ${escapeHtml(docModel.authorName)}</td></tr>
        <tr><td><strong>Ngày cuộc họp:</strong> ${escapeHtml(docModel.createdAtLabel)}</td><td><strong>Thời lượng:</strong> ${escapeHtml(docModel.durationLabel)}</td></tr>
      </table>
    </section>`
        : `<header class="doc-header">
      <div class="doc-kicker">${escapeHtml(docModel.organizationName)} · ${escapeHtml(docModel.documentCode)}</div>
      <h1>${escapeHtml(docModel.title)}</h1>
    </header>`
    }
    ${
      config.includeToc !== false && docModel.tocItems?.length > 0
        ? `<section class="toc-box">
      <h2 style="margin-top:0;">Mục lục nội dung</h2>
      ${docModel.tocItems
        .map(
          (item) =>
            `<div class="toc-item"><span><strong>${escapeHtml(item.number)}.</strong> ${escapeHtml(
              item.label
            )}</span><span>§${escapeHtml(item.number)}</span></div>`
        )
        .join('')}
    </section>`
        : ''
    }
    ${metadataHtml}
    ${summaryHtml}
    ${tasksHtml}
    ${ocrHtml}
    ${transcriptHtml}
    <section class="sig-grid">
      <div class="sig-col">
        <div style="font-weight:700;font-size:12px;">NGƯỜI LẬP BIÊN BẢN</div>
        <div style="font-size:11px;color:#64748b;font-style:italic;">(Ký và ghi rõ họ tên)</div>
        <div style="margin-top:42px;font-weight:600;">${escapeHtml(docModel.authorName)}</div>
      </div>
      <div class="sig-col">
        <div style="font-weight:700;font-size:12px;">ĐẠI DIỆN PHÊ DUYỆT</div>
        <div style="font-size:11px;color:#64748b;font-style:italic;">(Ký và ghi rõ họ tên)</div>
        <div style="margin-top:42px;font-weight:600;">${escapeHtml(docModel.recipientGroup)}</div>
      </div>
    </section>
    ${
      config.includeWatermark
        ? `<footer class="doc-footer"><span>Generated by SmartRec AI · ${escapeHtml(
            docModel.documentCode
          )}</span><span>${escapeHtml(docModel.exportedAtLabel)}</span></footer>`
        : ''
    }
  </div>
</body>
</html>`;
}

export function generateWordDocHtml(docModel, config = DEFAULT_EXPORT_CONFIG) {
  return `\ufeff${generateDocumentHtml(docModel, config, { forWord: true })}`;
}

export function generateExportJson(docModel, config = DEFAULT_EXPORT_CONFIG) {
  const sections = config.sections || DEFAULT_EXPORT_CONFIG.sections;
  const payload = {
    title: docModel.title,
    exportedAt: new Date().toISOString(),
    templateId: config.templateId,
    ...(sections.metadata
      ? {
          metadata: {
            organizationName: docModel.organizationName,
            authorName: docModel.authorName,
            createdAt: docModel.createdAtLabel,
            duration: docModel.durationLabel,
            status: docModel.statusLabel,
            participants: docModel.participants,
          },
        }
      : {}),
    ...(sections.summary ? { summary: docModel.summary } : {}),
    ...(sections.tasks ? { tasks: docModel.tasks } : {}),
    ...(sections.ocr ? { ocrSlides: docModel.ocrSlides } : {}),
    ...(sections.transcript ? { transcript: docModel.transcript } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

export function buildSafeFileName(title, extension) {
  const base = String(title || 'smartrec-meeting')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `${base || 'smartrec_document'}.${extension}`;
}

export function printDocumentPreview(docModel, config) {
  if (typeof document === 'undefined') return false;
  const html = generateDocumentHtml(docModel, config, { forWord: false });
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!frameDoc) {
    document.body.removeChild(iframe);
    return false;
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 1000);
    }
  }, 150);

  return true;
}

export function downloadExportFile(docModel, config) {
  const format = config?.format || 'md';
  if (format === 'pdf') {
    const printed = printDocumentPreview(docModel, config);
    return { ok: printed, fileName: buildSafeFileName(docModel.title, 'pdf'), mode: 'print' };
  }

  let content = '';
  let mimeType = 'text/plain;charset=utf-8';
  let ext = format;

  if (format === 'md') {
    content = generateMarkdown(docModel, config);
    mimeType = 'text/markdown;charset=utf-8';
  } else if (format === 'doc') {
    content = generateWordDocHtml(docModel, config);
    mimeType = 'application/msword;charset=utf-8';
  } else if (format === 'html') {
    content = generateDocumentHtml(docModel, config);
    mimeType = 'text/html;charset=utf-8';
  } else if (format === 'json') {
    content = generateExportJson(docModel, config);
    mimeType = 'application/json;charset=utf-8';
  } else {
    ext = 'md';
    content = generateMarkdown(docModel, config);
  }

  const fileName = buildSafeFileName(docModel.title, ext);
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { ok: true, fileName, content, mode: 'download' };
}

