import {
  ACCENT_THEMES,
  DEFAULT_EXPORT_CONFIG,
  buildSafeFileName,
} from './documentExporterService.js';

export const WORD_FONTS = [
  { id: 'Calibri', label: 'Calibri', css: 'Calibri, "Segoe UI", Arial, sans-serif' },
  { id: 'Times New Roman', label: 'Times New Roman', css: '"Times New Roman", Georgia, serif' },
  { id: 'Arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { id: 'Segoe UI', label: 'Segoe UI', css: '"Segoe UI", system-ui, sans-serif' },
];

export const WORD_FONT_SIZES = [11, 12, 13];
export const WORD_LINE_SPACINGS = [1.15, 1.5];

export const WORD_MARGIN_PRESETS = [
  { id: 'normal', label: 'Normal (2.54 cm)', cm: 2.54, px: 52, twips: 1440 },
  { id: 'moderate', label: 'Moderate (1.91 cm)', cm: 1.91, px: 40, twips: 1080 },
  { id: 'narrow', label: 'Narrow (1.27 cm)', cm: 1.27, px: 28, twips: 720 },
];

export const DEFAULT_WORD_OPTIONS = {
  fontFamily: 'Calibri',
  fontSizePt: 11,
  lineSpacing: 1.15,
  marginPreset: 'normal',
  showCoverPage: true,
  showRuler: true,
  showHeaderFooter: true,
  showToc: true,
  reviewNote: '',
};

export function resolveWordFont(fontFamily) {
  return WORD_FONTS.find((f) => f.id === fontFamily) || WORD_FONTS[0];
}

export function resolveWordMargin(marginPreset) {
  return WORD_MARGIN_PRESETS.find((m) => m.id === marginPreset) || WORD_MARGIN_PRESETS[0];
}

function estimateCharsPerLine(wordOptions) {
  const margin = resolveWordMargin(wordOptions.marginPreset);
  const sizeRatio = 11 / Math.max(10, Number(wordOptions.fontSizePt) || 11);
  const widthFactor = margin.id === 'narrow' ? 1.18 : margin.id === 'moderate' ? 1.09 : 1;
  return Math.max(54, Math.round(78 * sizeRatio * widthFactor));
}

function estimateLines(text, charsPerLine) {
  const len = String(text || '').trim().length;
  return Math.max(1, Math.ceil(len / charsPerLine));
}

/**
 * Splits active sections into discrete A4 Word pages:
 * - Page 1: Formal Cover Page (when enabled)
 * - Page 2+: Mục lục with live computed page numbers, Metadata, Numbered Sections & Signature block
 */
export function paginateWordBlocks(
  docModel,
  wordOptions = DEFAULT_WORD_OPTIONS,
  config = DEFAULT_EXPORT_CONFIG
) {
  if (!docModel) return [{ pageNumber: 1, isCoverPage: false, blocks: [] }];

  const sections = config?.sections || DEFAULT_EXPORT_CONFIG.sections;
  const lineH =
    (Number(wordOptions.fontSizePt) || 11) * (Number(wordOptions.lineSpacing) || 1.15) * 1.45;
  const margin = resolveWordMargin(wordOptions.marginPreset);
  const maxPageUnits = margin.id === 'narrow' ? 880 : margin.id === 'moderate' ? 830 : 780;
  const charsPerLine = estimateCharsPerLine(wordOptions);

  const showCover =
    config?.includeCoverPage !== false && wordOptions.showCoverPage !== false;
  const showToc = config?.includeToc !== false && wordOptions.showToc !== false;

  const pages = [];
  if (showCover) {
    pages.push({
      pageNumber: 1,
      isCoverPage: true,
      blocks: [{ id: 'cover-page', kind: 'cover_page' }],
    });
  }

  const contentBlocks = [];
  if (!showCover) {
    contentBlocks.push({
      id: 'doc-title-header',
      kind: 'header',
      weight: 96,
    });
  }

  const tocPlaceholder = showToc
    ? {
        id: 'doc-toc',
        kind: 'toc',
        entries: [],
        weight: 140,
      }
    : null;
  if (tocPlaceholder) {
    contentBlocks.push(tocPlaceholder);
  }

  if (sections.metadata) {
    contentBlocks.push({
      id: 'doc-metadata',
      kind: 'metadata',
      tocKey: 'metadata',
      tocLabel: 'I. Thông tin chung cuộc họp',
      weight: 108,
    });
  }

  let sectionNum = 1;
  if (sections.summary) {
    const title = `${sectionNum++}. Tóm tắt điều hành (AI Summary)`;
    contentBlocks.push({
      id: 'summary-heading',
      kind: 'section_heading',
      title,
      tocKey: 'summary',
      tocLabel: title,
      weight: 36,
    });
    if (!docModel.summary || docModel.summary.length === 0) {
      contentBlocks.push({
        id: 'summary-empty',
        kind: 'empty',
        text: 'Chưa có nội dung tóm tắt.',
        weight: 28,
      });
    } else {
      docModel.summary.forEach((item, idx) => {
        const lines = estimateLines(item.content, charsPerLine);
        contentBlocks.push({
          id: `summary-${idx}`,
          kind: 'summary_item',
          item,
          index: idx,
          weight: 38 + lines * lineH,
        });
      });
    }
  }

  if (sections.tasks) {
    const taskRows = docModel.tasks || [];
    const title = `${sectionNum++}. Bảng Action Items & Phân công (${taskRows.length})`;
    contentBlocks.push({
      id: 'tasks-heading',
      kind: 'section_heading',
      title,
      tocKey: 'tasks',
      tocLabel: title,
      weight: 36,
    });
    if (taskRows.length === 0) {
      contentBlocks.push({
        id: 'tasks-empty',
        kind: 'empty',
        text: 'Chưa có công việc nào.',
        weight: 28,
      });
    } else {
      const chunkSize = 6;
      for (let i = 0; i < taskRows.length; i += chunkSize) {
        const slice = taskRows.slice(i, i + chunkSize);
        const rowsHeight = slice.reduce(
          (sum, row) => sum + 24 + estimateLines(row.content, 34) * lineH,
          36
        );
        contentBlocks.push({
          id: `tasks-chunk-${i}`,
          kind: 'tasks_table',
          rows: slice,
          isContinuation: i > 0,
          weight: rowsHeight,
        });
      }
    }
  }

  if (sections.ocr && docModel.ocrSlides?.length > 0) {
    const title = `${sectionNum++}. Slide Keyframes & OCR (${docModel.ocrSlides.length})`;
    contentBlocks.push({
      id: 'ocr-heading',
      kind: 'section_heading',
      title,
      tocKey: 'ocr',
      tocLabel: title,
      weight: 36,
    });
    docModel.ocrSlides.forEach((slide, idx) => {
      const lines = estimateLines(slide.raw_text, charsPerLine);
      contentBlocks.push({
        id: `ocr-${idx}`,
        kind: 'ocr_item',
        slide,
        index: idx,
        weight: 38 + lines * lineH,
      });
    });
  }

  if (sections.transcript && docModel.transcript?.length > 0) {
    const title = `${sectionNum++}. Transcript chi tiết cuộc họp (${docModel.transcript.length} đoạn)`;
    contentBlocks.push({
      id: 'transcript-heading',
      kind: 'section_heading',
      title,
      tocKey: 'transcript',
      tocLabel: title,
      weight: 36,
    });
    docModel.transcript.forEach((entry) => {
      const lines = estimateLines(entry.text, charsPerLine);
      contentBlocks.push({
        id: `transcript-${entry.chunkKey}`,
        kind: 'transcript_item',
        entry,
        weight: 26 + lines * lineH,
      });
    });
  }

  if (String(wordOptions.reviewNote || '').trim()) {
    const noteLines = estimateLines(wordOptions.reviewNote, charsPerLine);
    contentBlocks.push({
      id: 'review-note',
      kind: 'review_note',
      note: wordOptions.reviewNote.trim(),
      tocKey: 'review_note',
      tocLabel: `${sectionNum++}. Ghi chú & Phê duyệt phát hành`,
      weight: 44 + noteLines * lineH,
    });
  }

  contentBlocks.push({
    id: 'signature-block',
    kind: 'signature_block',
    weight: 108,
  });

  let currentBlocks = [];
  let currentWeight = 0;

  contentBlocks.forEach((block) => {
    const exceeds = currentBlocks.length > 0 && currentWeight + block.weight > maxPageUnits;
    if (exceeds) {
      pages.push({ pageNumber: pages.length + 1, isCoverPage: false, blocks: currentBlocks });
      currentBlocks = [block];
      currentWeight = block.weight;
    } else {
      currentBlocks.push(block);
      currentWeight += block.weight;
    }
  });

  if (currentBlocks.length > 0 || pages.length === 0) {
    pages.push({ pageNumber: pages.length + 1, isCoverPage: false, blocks: currentBlocks });
  }

  // Compute exact page numbers for Mục lục entries after pagination
  if (tocPlaceholder) {
    const tocEntries = [];
    pages.forEach((pg) => {
      pg.blocks.forEach((blk) => {
        if (blk.tocLabel) {
          tocEntries.push({
            key: blk.tocKey,
            label: blk.tocLabel,
            pageNumber: pg.pageNumber,
          });
        }
      });
    });
    tocPlaceholder.entries = tocEntries;
  }

  return pages;
}

// IEEE 802.3 CRC-32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(typeStr, dataBytes) {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(typeStr);
  const chunk = new Uint8Array(12 + dataBytes.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, dataBytes.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(dataBytes, 8);
  const crcInput = chunk.subarray(4, 8 + dataBytes.length);
  dv.setUint32(8 + dataBytes.length, crc32(crcInput), false);
  return chunk;
}

/**
 * Generates a 64x64 RGBA PNG matching SmartRec's blue-to-cyan gradient badge with white inner ring.
 */
export function createSmartRecLogoPngBytes() {
  const size = 64;
  const rawLen = size * (1 + size * 4);
  const raw = new Uint8Array(rawLen);
  const radius = 15;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      // Rounded-rect alpha check
      const rx = Math.max(0, Math.abs(x - 31.5) - (31.5 - radius));
      const ry = Math.max(0, Math.abs(y - 31.5) - (31.5 - radius));
      const cornerDist = Math.hypot(rx, ry);
      if (cornerDist > radius) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      const t = (x + y) / (2 * (size - 1));
      let r = Math.round(37 + (0 - 37) * t);
      let g = Math.round(99 + (209 - 99) * t);
      let b = Math.round(235 + (255 - 235) * t);

      const centerDist = Math.hypot(x - 31.5, y - 31.5);
      if (centerDist >= 10 && centerDist <= 14.2) {
        r = 255;
        g = 255;
        b = 255;
      } else if (centerDist < 10) {
        r = Math.round(r * 0.78 + 255 * 0.22);
        g = Math.round(g * 0.78 + 255 * 0.22);
        b = Math.round(b * 0.78 + 255 * 0.22);
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }

  // Zlib wrapper with single uncompressed DEFLATE block
  const zlibData = new Uint8Array(2 + 5 + raw.length + 4);
  const zdv = new DataView(zlibData.buffer);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;
  zlibData[2] = 0x01; // BFINAL=1, BTYPE=00 (stored)
  zdv.setUint16(3, raw.length, true);
  zdv.setUint16(5, (~raw.length) & 0xffff, true);
  zlibData.set(raw, 7);
  zdv.setUint32(7 + raw.length, adler32(raw), false);

  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, size, false);
  idv.setUint32(4, size, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const cIhdr = pngChunk('IHDR', ihdr);
  const cIdat = pngChunk('IDAT', zlibData);
  const cIend = pngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
  let pos = 0;
  [sig, cIhdr, cIdat, cIend].forEach((part) => {
    png.set(part, pos);
    pos += part.length;
  });
  return png;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHash(hex) {
  return String(hex || '#1d4ed8').replace(/^#/, '').toUpperCase();
}

function xmlParagraph(
  text,
  { bold = false, italic = false, sizeHalfPt, colorHex, spaceBefore = 0, spaceAfter = 120, leftBorderHex, align = 'left' } = {}
) {
  const pPrParts = [`<w:jc w:val="${align}"/>`, `<w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}"/>`];
  if (leftBorderHex) {
    pPrParts.push(
      `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${leftBorderHex}"/></w:pBdr>`
    );
  }
  const rPrParts = [];
  if (bold) rPrParts.push('<w:b/>');
  if (italic) rPrParts.push('<w:i/>');
  if (sizeHalfPt) rPrParts.push(`<w:sz w:val="${sizeHalfPt}"/><w:szCs w:val="${sizeHalfPt}"/>`);
  if (colorHex) rPrParts.push(`<w:color w:val="${colorHex}"/>`);

  return `<w:p><w:pPr>${pPrParts.join('')}</w:pPr><w:r>${
    rPrParts.length ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : ''
  }<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function xmlLogoDrawingParagraph(relId = 'rId2', emuSize = 480000) {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="140"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emuSize}" cy="${emuSize}"/><wp:docPr id="1" name="SmartRec Logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="smartrec-logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emuSize}" cy="${emuSize}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function xmlTableCell(
  text,
  { widthDxa, bold = false, italic = false, fillHex, colorHex, align = 'left', borderColor = 'CBD5E1', noBorder = false } = {}
) {
  const bdrVal = noBorder ? 'none' : 'single';
  const bdrSz = noBorder ? '0' : '4';
  const tcBorders = `<w:tcBorders><w:top w:val="${bdrVal}" w:sz="${bdrSz}" w:space="0" w:color="${borderColor}"/><w:left w:val="${bdrVal}" w:sz="${bdrSz}" w:space="0" w:color="${borderColor}"/><w:bottom w:val="${bdrVal}" w:sz="${bdrSz}" w:space="0" w:color="${borderColor}"/><w:right w:val="${bdrVal}" w:sz="${bdrSz}" w:space="0" w:color="${borderColor}"/></w:tcBorders>`;
  const shd = fillHex ? `<w:shd w:val="clear" w:color="auto" w:fill="${fillHex}"/>` : '';
  const rPr = `${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${colorHex ? `<w:color w:val="${colorHex}"/>` : ''}`;
  return `<w:tc><w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa"/>${tcBorders}${shd}</w:tcPr><w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r>${
    rPr ? `<w:rPr>${rPr}</w:rPr>` : ''
  }<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
}

/**
 * Generates OOXML parts (including Cover Page with SmartRec PNG Logo, TOC, Metadata, Tables & Signature block).
 */
export function buildDocxXmlFiles(
  docModel,
  wordOptions = DEFAULT_WORD_OPTIONS,
  config = DEFAULT_EXPORT_CONFIG
) {
  const sections = config?.sections || DEFAULT_EXPORT_CONFIG.sections;
  const theme = ACCENT_THEMES.find((t) => t.id === config?.accentTheme) || ACCENT_THEMES[0];
  const primaryHex = stripHash(theme.primary);
  const softHex = stripHash(theme.soft);
  const font = resolveWordFont(wordOptions.fontFamily);
  const margin = resolveWordMargin(wordOptions.marginPreset);
  const sizeHalfPt = (Number(wordOptions.fontSizePt) || 11) * 2;
  const lineUnits = Math.round((Number(wordOptions.lineSpacing) || 1.15) * 240);
  const contentWidthDxa = 11906 - margin.twips * 2;
  const showCover =
    config?.includeCoverPage !== false && wordOptions.showCoverPage !== false;
  const showToc = config?.includeToc !== false && wordOptions.showToc !== false;

  const pages = paginateWordBlocks(docModel, wordOptions, config);
  const tocBlock = pages.flatMap((p) => p.blocks).find((b) => b.kind === 'toc');

  const bodyParts = [];

  if (showCover) {
    // Formal Cover Page Header + SmartRec Embedded PNG Logo
    bodyParts.push(
      xmlParagraph(`${String(docModel.organizationName || 'SMARTREC AI').toUpperCase()}`, {
        bold: true,
        sizeHalfPt: 22,
        colorHex: primaryHex,
        align: 'center',
        spaceBefore: 120,
        spaceAfter: 40,
      })
    );
    bodyParts.push(
      xmlParagraph(`Số / Ký hiệu: ${docModel.documentCode || 'BBH-001'}`, {
        italic: true,
        sizeHalfPt: 18,
        colorHex: '475569',
        align: 'center',
        spaceAfter: 240,
      })
    );
    bodyParts.push(xmlLogoDrawingParagraph('rId2', 520000));
    bodyParts.push(
      xmlParagraph('SmartRec · AI Meeting Intelligence', {
        bold: true,
        sizeHalfPt: 22,
        colorHex: '0284C7',
        align: 'center',
        spaceAfter: 360,
      })
    );
    bodyParts.push(
      xmlParagraph(String(docModel.documentSubtitle || 'BIÊN BẢN CUỘC HỌP & BÁO CÁO PHÂN TÍCH AI').toUpperCase(), {
        bold: true,
        sizeHalfPt: 22,
        colorHex: primaryHex,
        align: 'center',
        spaceAfter: 140,
      })
    );
    bodyParts.push(
      xmlParagraph(docModel.title || 'Biên bản cuộc họp', {
        bold: true,
        sizeHalfPt: 40,
        colorHex: '0F172A',
        align: 'center',
        spaceAfter: 420,
      })
    );

    const coverLabelW = Math.round(contentWidthDxa * 0.34);
    const coverValW = contentWidthDxa - coverLabelW;
    bodyParts.push(
      `<w:tbl><w:tblPr><w:tblW w:w="${contentWidthDxa}" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="${coverLabelW}"/><w:gridCol w:w="${coverValW}"/></w:tblGrid>` +
        `<w:tr>${xmlTableCell('Kính gửi / Nơi nhận', { widthDxa: coverLabelW, bold: true, fillHex: softHex })}${xmlTableCell(docModel.recipientGroup || 'Ban Giám đốc & Thành viên dự án', { widthDxa: coverValW, fillHex: softHex })}</w:tr>` +
        `<w:tr>${xmlTableCell('Đơn vị chủ trì', { widthDxa: coverLabelW, bold: true })}${xmlTableCell(docModel.organizationName, { widthDxa: coverValW })}</w:tr>` +
        `<w:tr>${xmlTableCell('Người lập biên bản', { widthDxa: coverLabelW, bold: true, fillHex: softHex })}${xmlTableCell(docModel.authorName, { widthDxa: coverValW, fillHex: softHex })}</w:tr>` +
        `<w:tr>${xmlTableCell('Ngày họp & Thời lượng', { widthDxa: coverLabelW, bold: true })}${xmlTableCell(`${docModel.createdAtLabel} · ${docModel.durationLabel}`, { widthDxa: coverValW })}</w:tr>` +
        `<w:tr>${xmlTableCell('Thành phần tham dự', { widthDxa: coverLabelW, bold: true, fillHex: softHex })}${xmlTableCell((docModel.participants || []).join(', ') || '—', { widthDxa: coverValW, fillHex: softHex })}</w:tr>` +
        `</w:tbl>`
    );

    bodyParts.push(
      xmlParagraph(`Ban hành ngày ${docModel.exportedAtLabel} · ${docModel.meetingLocation || 'SmartRec Workspace'}`, {
        italic: true,
        sizeHalfPt: 18,
        colorHex: '64748B',
        align: 'center',
        spaceBefore: 600,
        spaceAfter: 0,
      })
    );
    // Page break after Cover Page
    bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  } else {
    bodyParts.push(
      xmlParagraph(`${docModel.organizationName || 'SmartRec AI'} · ${docModel.documentCode || 'MEETING MINUTES'}`, {
        bold: true,
        sizeHalfPt: 18,
        colorHex: primaryHex,
        spaceAfter: 60,
      })
    );
    bodyParts.push(
      xmlParagraph(docModel.title || 'Biên bản cuộc họp', {
        bold: true,
        sizeHalfPt: 34,
        colorHex: '0F172A',
        spaceAfter: 180,
      })
    );
  }

  // Table of Contents (Mục lục)
  if (showToc && tocBlock?.entries?.length > 0) {
    bodyParts.push(
      xmlParagraph('MỤC LỤC TÀI LIỆU', {
        bold: true,
        sizeHalfPt: sizeHalfPt + 4,
        colorHex: primaryHex,
        leftBorderHex: primaryHex,
        spaceAfter: 100,
      })
    );
    const tocTitleW = Math.round(contentWidthDxa * 0.84);
    const tocPageW = contentWidthDxa - tocTitleW;
    const tocRowsXml = tocBlock.entries
      .map((entry, idx) =>
        `<w:tr>${xmlTableCell(entry.label, {
          widthDxa: tocTitleW,
          fillHex: idx % 2 === 0 ? softHex : undefined,
        })}${xmlTableCell(`Trang ${entry.pageNumber}`, {
          widthDxa: tocPageW,
          bold: true,
          fillHex: idx % 2 === 0 ? softHex : undefined,
          align: 'right',
        })}</w:tr>`
      )
      .join('');
    bodyParts.push(
      `<w:tbl><w:tblPr><w:tblW w:w="${contentWidthDxa}" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="${tocTitleW}"/><w:gridCol w:w="${tocPageW}"/></w:tblGrid>${tocRowsXml}</w:tbl>`
    );
    bodyParts.push(xmlParagraph('', { spaceAfter: 140 }));
  }

  if (sections.metadata) {
    bodyParts.push(
      xmlParagraph('I. Thông tin chung cuộc họp', {
        bold: true,
        sizeHalfPt: sizeHalfPt + 4,
        colorHex: primaryHex,
        leftBorderHex: primaryHex,
        spaceAfter: 100,
      })
    );
    const colHalf = Math.floor(contentWidthDxa / 2);
    bodyParts.push(
      `<w:tbl><w:tblPr><w:tblW w:w="${contentWidthDxa}" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="${colHalf}"/><w:gridCol w:w="${
        contentWidthDxa - colHalf
      }"/></w:tblGrid>` +
        `<w:tr>${xmlTableCell(`Đơn vị: ${docModel.organizationName}`, {
          widthDxa: colHalf,
          fillHex: softHex,
        })}${xmlTableCell(`Số hiệu: ${docModel.documentCode}`, {
          widthDxa: contentWidthDxa - colHalf,
          fillHex: softHex,
        })}</w:tr>` +
        `<w:tr>${xmlTableCell(`Ngày họp: ${docModel.createdAtLabel}`, {
          widthDxa: colHalf,
          fillHex: softHex,
        })}${xmlTableCell(`Thời lượng: ${docModel.durationLabel}`, {
          widthDxa: contentWidthDxa - colHalf,
          fillHex: softHex,
        })}</w:tr>` +
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="${contentWidthDxa}" w:type="dxa"/><w:gridSpan w:val="2"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="${softHex}"/></w:tcPr><w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
          `Thành phần tham gia: ${(docModel.participants || []).join(', ') || '—'}`
        )}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    bodyParts.push(xmlParagraph('', { spaceAfter: 120 }));
  }

  let sectionIdx = 1;
  if (sections.summary) {
    bodyParts.push(
      xmlParagraph(`${sectionIdx++}. Tóm tắt điều hành (AI Summary)`, {
        bold: true,
        sizeHalfPt: sizeHalfPt + 4,
        colorHex: primaryHex,
        leftBorderHex: primaryHex,
        spaceAfter: 100,
      })
    );
    (docModel.summary || []).forEach((item, idx) => {
      bodyParts.push(
        xmlParagraph(item.heading || `Mục ${idx + 1}`, {
          bold: true,
          sizeHalfPt,
          spaceAfter: 40,
        })
      );
      bodyParts.push(xmlParagraph(item.content || '', { sizeHalfPt, spaceAfter: 120 }));
    });
  }

  if (sections.tasks) {
    bodyParts.push(
      xmlParagraph(`${sectionIdx++}. Bảng Action Items & Phân công (${docModel.tasks?.length || 0})`, {
        bold: true,
        sizeHalfPt: sizeHalfPt + 4,
        colorHex: primaryHex,
        leftBorderHex: primaryHex,
        spaceAfter: 100,
      })
    );
    const taskRows = docModel.tasks || [];
    if (taskRows.length === 0) {
      bodyParts.push(
        xmlParagraph('Chưa có công việc nào được ghi nhận.', { italic: true, spaceAfter: 120 })
      );
    } else {
      const colWidths = config.includeTimestamps
        ? [
            Math.round(contentWidthDxa * 0.06),
            Math.round(contentWidthDxa * 0.4),
            Math.round(contentWidthDxa * 0.17),
            Math.round(contentWidthDxa * 0.17),
            Math.round(contentWidthDxa * 0.12),
            contentWidthDxa -
              (Math.round(contentWidthDxa * 0.06) +
                Math.round(contentWidthDxa * 0.4) +
                Math.round(contentWidthDxa * 0.17) * 2 +
                Math.round(contentWidthDxa * 0.12)),
          ]
        : [
            Math.round(contentWidthDxa * 0.07),
            Math.round(contentWidthDxa * 0.45),
            Math.round(contentWidthDxa * 0.18),
            Math.round(contentWidthDxa * 0.18),
            contentWidthDxa -
              (Math.round(contentWidthDxa * 0.07) +
                Math.round(contentWidthDxa * 0.45) +
                Math.round(contentWidthDxa * 0.18) * 2),
          ];

      const gridCols = colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
      const headerCells = [
        xmlTableCell('#', { widthDxa: colWidths[0], bold: true, fillHex: primaryHex, colorHex: 'FFFFFF', align: 'center' }),
        xmlTableCell('Nội dung công việc', { widthDxa: colWidths[1], bold: true, fillHex: primaryHex, colorHex: 'FFFFFF' }),
        xmlTableCell('Thực hiện', { widthDxa: colWidths[2], bold: true, fillHex: primaryHex, colorHex: 'FFFFFF' }),
        xmlTableCell('Phụ trách', { widthDxa: colWidths[3], bold: true, fillHex: primaryHex, colorHex: 'FFFFFF' }),
        xmlTableCell('Hạn chót', { widthDxa: colWidths[4], bold: true, fillHex: primaryHex, colorHex: 'FFFFFF' }),
        ...(config.includeTimestamps
          ? [xmlTableCell('TG', { widthDxa: colWidths[5], bold: true, fillHex: primaryHex, colorHex: 'FFFFFF', align: 'center' })]
          : []),
      ].join('');

      const rowsXml = taskRows
        .map((task, idx) => {
          const rowFill = idx % 2 === 1 ? 'F8FAFC' : undefined;
          return `<w:tr>${[
            xmlTableCell(String(task.task_index ?? idx + 1), {
              widthDxa: colWidths[0],
              fillHex: rowFill,
              align: 'center',
            }),
            xmlTableCell(task.content || '', { widthDxa: colWidths[1], fillHex: rowFill }),
            xmlTableCell(task.assignee || '—', { widthDxa: colWidths[2], fillHex: rowFill }),
            xmlTableCell(task.responsible || '—', { widthDxa: colWidths[3], fillHex: rowFill }),
            xmlTableCell(task.deadline || '—', { widthDxa: colWidths[4], fillHex: rowFill }),
            ...(config.includeTimestamps
              ? [
                  xmlTableCell(task.timestamp || '—', {
                    widthDxa: colWidths[5],
                    fillHex: rowFill,
                    align: 'center',
                  }),
                ]
              : []),
          ].join('')}</w:tr>`;
        })
        .join('');

      bodyParts.push(
        `<w:tbl><w:tblPr><w:tblW w:w="${contentWidthDxa}" w:type="dxa"/></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid><w:tr>${headerCells}</w:tr>${rowsXml}</w:tbl>`
      );
      bodyParts.push(xmlParagraph('', { spaceAfter: 120 }));
    }
  }

  if (sections.ocr && docModel.ocrSlides?.length > 0) {
    bodyParts.push(
      xmlParagraph(`${sectionIdx++}. Slide Keyframes & OCR (${docModel.ocrSlides.length})`, {
        bold: true,
        sizeHalfPt: sizeHalfPt + 4,
        colorHex: primaryHex,
        leftBorderHex: primaryHex,
        spaceAfter: 100,
      })
    );
    docModel.ocrSlides.forEach((slide, idx) => {
      const ts = config.includeTimestamps && slide.timestamp ? ` [${slide.timestamp}]` : '';
      bodyParts.push(
        xmlParagraph(`${idx + 1}. ${slide.slide_title || 'Slide'}${ts}`, {
          bold: true,
          spaceAfter: 40,
        })
      );
      bodyParts.push(xmlParagraph(slide.raw_text || '', { spaceAfter: 100 }));
    });
  }

  if (sections.transcript && docModel.transcript?.length > 0) {
    bodyParts.push(
      xmlParagraph(
        `${sectionIdx++}. Transcript chi tiết cuộc họp (${docModel.transcript.length} đoạn)`,
        {
          bold: true,
          sizeHalfPt: sizeHalfPt + 4,
          colorHex: primaryHex,
          leftBorderHex: primaryHex,
          spaceAfter: 100,
        }
      )
    );
    docModel.transcript.forEach((entry) => {
      const ts = config.includeTimestamps ? ` [${entry.timeStart} - ${entry.timeEnd}]` : '';
      bodyParts.push(
        `<w:p><w:pPr><w:spacing w:after="90"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="${primaryHex}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
          `${entry.speakerName}${ts}: `
        )}</w:t></w:r><w:r><w:t xml:space="preserve">${escapeXml(entry.text || '')}</w:t></w:r></w:p>`
      );
    });
  }

  if (String(wordOptions.reviewNote || '').trim()) {
    bodyParts.push(
      xmlParagraph(`${sectionIdx++}. Ghi chú & Phê duyệt trước khi phát hành`, {
        bold: true,
        sizeHalfPt: sizeHalfPt + 2,
        colorHex: primaryHex,
        leftBorderHex: primaryHex,
        spaceAfter: 60,
      })
    );
    bodyParts.push(xmlParagraph(wordOptions.reviewNote.trim(), { spaceAfter: 160 }));
  }

  // Formal 2-column Signature Block
  const sigColW = Math.floor(contentWidthDxa / 2);
  bodyParts.push(
    `<w:tbl><w:tblPr><w:tblW w:w="${contentWidthDxa}" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="${sigColW}"/><w:gridCol w:w="${
      contentWidthDxa - sigColW
    }"/></w:tblGrid>` +
      `<w:tr>${xmlTableCell('NGƯỜI LẬP BIÊN BẢN\n(Ký và ghi rõ họ tên)', {
        widthDxa: sigColW,
        bold: true,
        align: 'center',
        noBorder: true,
      })}${xmlTableCell('ĐẠI DIỆN PHÊ DUYỆT\n(Ký và ghi rõ họ tên)', {
        widthDxa: contentWidthDxa - sigColW,
        bold: true,
        align: 'center',
        noBorder: true,
      })}</w:tr>` +
      `<w:tr>${xmlTableCell(`\n\n${docModel.authorName}`, {
        widthDxa: sigColW,
        italic: true,
        align: 'center',
        noBorder: true,
      })}${xmlTableCell(`\n\n${docModel.recipientGroup || 'Ban Giám đốc'}`, {
        widthDxa: contentWidthDxa - sigColW,
        italic: true,
        align: 'center',
        noBorder: true,
      })}</w:tr></w:tbl>`
  );

  if (config.includeWatermark) {
    bodyParts.push(
      xmlParagraph(
        `Generated by SmartRec AI Workspace · ${docModel.documentCode} · ${docModel.exportedAtLabel}`,
        {
          italic: true,
          sizeHalfPt: 18,
          colorHex: '64748B',
          spaceBefore: 160,
          spaceAfter: 0,
        }
      )
    );
  }

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    `<w:body>${bodyParts.join('')}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${margin.twips}" w:right="${margin.twips}" w:bottom="${margin.twips}" w:left="${margin.twips}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    '</w:body></w:document>';

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${escapeXml(
      font.id
    )}" w:hAnsi="${escapeXml(font.id)}" w:cs="${escapeXml(
      font.id
    )}"/><w:sz w:val="${sizeHalfPt}"/><w:szCs w:val="${sizeHalfPt}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="${lineUnits}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '</w:styles>';

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/smartrec-logo.png"/>' +
    '</Relationships>';

  return {
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': rootRelsXml,
    'word/_rels/document.xml.rels': docRelsXml,
    'word/styles.xml': stylesXml,
    'word/media/smartrec-logo.png': createSmartRecLogoPngBytes(),
    'word/document.xml': documentXml,
  };
}

/**
 * Packs named UTF-8 text or binary Uint8Array files into a valid Stored ZIP archive.
 */
export function buildStoredZipBytes(filesMap) {
  const encoder = new TextEncoder();
  const entries = Object.entries(filesMap).map(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const dataBytes = content instanceof Uint8Array ? content : encoder.encode(String(content));
    return {
      nameBytes,
      dataBytes,
      crc: crc32(dataBytes),
    };
  });

  let offset = 0;
  const localParts = [];
  const centralParts = [];

  for (const entry of entries) {
    const localHeader = new Uint8Array(30 + entry.nameBytes.length);
    const ldv = new DataView(localHeader.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, 0x0800, true);
    ldv.setUint16(8, 0, true);
    ldv.setUint16(10, 0, true);
    ldv.setUint16(12, 0, true);
    ldv.setUint32(14, entry.crc, true);
    ldv.setUint32(18, entry.dataBytes.length, true);
    ldv.setUint32(22, entry.dataBytes.length, true);
    ldv.setUint16(26, entry.nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    localHeader.set(entry.nameBytes, 30);

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    const cdv = new DataView(centralHeader.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, entry.crc, true);
    cdv.setUint32(20, entry.dataBytes.length, true);
    cdv.setUint32(24, entry.dataBytes.length, true);
    cdv.setUint16(28, entry.nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    centralHeader.set(entry.nameBytes, 46);

    localParts.push(localHeader, entry.dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.dataBytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);

  const totalBytes = offset + centralSize + eocd.length;
  const output = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(eocd, cursor);
  return output;
}

export function createDocxBytes(
  docModel,
  wordOptions = DEFAULT_WORD_OPTIONS,
  config = DEFAULT_EXPORT_CONFIG
) {
  const xmlFiles = buildDocxXmlFiles(docModel, wordOptions, config);
  return buildStoredZipBytes(xmlFiles);
}

export function createDocxBlob(
  docModel,
  wordOptions = DEFAULT_WORD_OPTIONS,
  config = DEFAULT_EXPORT_CONFIG
) {
  const bytes = createDocxBytes(docModel, wordOptions, config);
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export function downloadDocxFile(
  docModel,
  wordOptions = DEFAULT_WORD_OPTIONS,
  config = DEFAULT_EXPORT_CONFIG
) {
  const fileName = buildSafeFileName(docModel?.title, 'docx');
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = createDocxBlob(docModel, wordOptions, config);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { ok: true, fileName, mode: 'download' };
}
