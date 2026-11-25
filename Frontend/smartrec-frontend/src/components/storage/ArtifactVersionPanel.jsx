import React, { useMemo, useState } from 'react';
import {
  ARTIFACT_INTEGRITY_STATUS,
  ARTIFACT_TYPES,
} from '../../services/artifactRetentionValidator';
import { formatBytes, formatDateTime } from '../../services/storageAdminService';

const INTEGRITY_BADGES = {
  [ARTIFACT_INTEGRITY_STATUS.VERIFIED]:
    'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
  [ARTIFACT_INTEGRITY_STATUS.VERSION_MISMATCH]:
    'bg-amber-500/15 text-amber-300 border-amber-500/35',
  [ARTIFACT_INTEGRITY_STATUS.MISSING_ARTIFACT]:
    'bg-rose-500/15 text-rose-300 border-rose-500/35',
  [ARTIFACT_INTEGRITY_STATUS.UNVERIFIED]:
    'bg-slate-800 text-slate-300 border-slate-600/60',
};

const LIFECYCLE_BADGES = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
  PINNED_BASELINE: 'bg-sky-500/15 text-[#38bdf8] border-[#38bdf8]/40',
  DEPRECATED: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35',
  TRASHED: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
  PURGED: 'bg-slate-700/40 text-slate-400 border-slate-600/50',
};

const TYPE_LABELS = {
  ALL: 'Tất cả loại',
  RAW_MEDIA: 'Raw Media',
  AI_OUTPUT: 'AI Output',
  EVAL_DATASET: 'Eval Dataset',
  GROUND_TRUTH: 'Ground Truth',
  ADAPTER_ARTIFACT: 'Adapter PoC',
};

const INTEGRITY_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Tất cả toàn vẹn' },
  { value: ARTIFACT_INTEGRITY_STATUS.VERIFIED, label: 'VERIFIED' },
  { value: ARTIFACT_INTEGRITY_STATUS.VERSION_MISMATCH, label: 'VERSION_MISMATCH' },
  { value: ARTIFACT_INTEGRITY_STATUS.MISSING_ARTIFACT, label: 'MISSING_ARTIFACT' },
  { value: ARTIFACT_INTEGRITY_STATUS.UNVERIFIED, label: 'UNVERIFIED' },
];

function shortHash(hash) {
  if (!hash) return '—';
  return hash.length > 14 ? `${hash.slice(0, 12)}…` : hash;
}

function SummaryTile({ label, value, toneClass }) {
  return (
    <div className="rounded-xl border border-[#1a2642] bg-[#090f1d] px-3.5 py-3 flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className={`text-xl font-bold font-mono ${toneClass}`}>{value}</span>
    </div>
  );
}

export default function ArtifactVersionPanel({
  snapshot,
  source = 'unverified',
  loading = false,
  error = null,
  onRefresh,
}) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [integrityFilter, setIntegrityFilter] = useState('ALL');
  const [keyword, setKeyword] = useState('');

  const items = snapshot?.items || [];
  const counts = snapshot?.counts || {
    total: 0,
    verified: 0,
    versionMismatch: 0,
    missingArtifact: 0,
    unverified: 0,
    retentionProtected: 0,
    purgeEligible: 0,
  };
  const policyApproved = Boolean(snapshot?.policyApproved);

  const filteredItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== 'ALL' && item.artifactType !== typeFilter) return false;
      if (integrityFilter !== 'ALL' && item.integrity?.status !== integrityFilter) return false;
      if (!query) return true;
      const haystack = [
        item.name,
        item.objectKey,
        item.version,
        item.checksumSha256,
        item.sourceRef,
        item.linkedJobId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [items, typeFilter, integrityFilter, keyword]);

  return (
    <div className="flex flex-col gap-4">
      {/* Policy & Verification Banner */}
      <div
        className={`rounded-xl border px-4 py-3 text-xs flex flex-col md:flex-row md:items-center justify-between gap-3 ${
          policyApproved && source === 'api'
            ? 'border-emerald-500/35 bg-emerald-950/25 text-emerald-200'
            : 'border-slate-700/70 bg-[#090f1d] text-slate-200'
        }`}
      >
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">
              Trạng thái Retention &amp; Versioning Policy:
            </span>
            <span
              data-testid="artifact-policy-badge"
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                policyApproved && source === 'api'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-300 border-slate-600'
              }`}
            >
              {policyApproved && source === 'api'
                ? `Đã xác nhận (${snapshot?.policyVersion || 'Active'})`
                : 'Chưa xác minh (UNVERIFIED)'}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              Bucket: {snapshot?.bucketName || 'smartrec-media'} · Retention mặc định:{' '}
              {snapshot?.defaultRetentionDays ?? 30} ngày
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            {policyApproved && source === 'api'
              ? 'Mọi artifact tuân thủ SemVer bất biến, đối soát SHA-256 và khóa bảo vệ trước mốc retainUntil / purgeAt.'
              : 'Chưa có dữ liệu phiên bản hoặc retention policy đã duyệt từ Backend — hệ thống khóa mọi thao tác xóa vĩnh viễn và không tạo dữ liệu giả (BR03).'}
          </p>
          {error && (
            <span className="text-[11px] font-mono text-slate-400">Chi tiết: {error}</span>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="self-start md:self-center shrink-0 px-3 py-1.5 rounded-lg border border-[#243b6b] bg-[#13203d] hover:bg-[#1a2b50] text-[11px] font-semibold text-[#38bdf8] disabled:opacity-50 transition"
        >
          {loading ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
        </button>
      </div>

      {/* Integrity & Retention Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile
          label="Đã xác minh (Verified)"
          value={source === 'api' ? counts.verified : '—'}
          toneClass="text-emerald-300"
        />
        <SummaryTile
          label="Lệch phiên bản (Mismatch)"
          value={source === 'api' ? counts.versionMismatch : '—'}
          toneClass="text-amber-300"
        />
        <SummaryTile
          label="Thiếu Artifact (Missing)"
          value={source === 'api' ? counts.missingArtifact : '—'}
          toneClass="text-rose-300"
        />
        <SummaryTile
          label="Đang bảo vệ Retention"
          value={source === 'api' ? counts.retentionProtected : '—'}
          toneClass="text-[#38bdf8]"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Tìm tên, object_key, version, SHA-256..."
          className="w-60 sm:w-72 px-3 py-1.5 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
        />

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Lọc theo loại artifact"
          className="px-3 py-1.5 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8]"
        >
          {ARTIFACT_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type] || type}
            </option>
          ))}
        </select>

        <select
          value={integrityFilter}
          onChange={(e) => setIntegrityFilter(e.target.value)}
          aria-label="Lọc theo trạng thái toàn vẹn"
          className="px-3 py-1.5 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8]"
        >
          {INTEGRITY_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Version & Retention Table */}
      <div className="w-full overflow-x-auto rounded-xl border border-[#162038]">
        <table className="w-full min-w-[920px] text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#090f1d] text-slate-400 border-b border-[#162038] whitespace-nowrap">
              <th className="py-3 px-4 font-semibold">Artifact &amp; Object Key</th>
              <th className="py-3 px-4 font-semibold">Version &amp; Checksum</th>
              <th className="py-3 px-4 font-semibold">Nguồn gốc (Lineage)</th>
              <th className="py-3 px-4 font-semibold">Toàn vẹn</th>
              <th className="py-3 px-4 font-semibold">Vòng đời &amp; Retention</th>
              <th className="py-3 px-4 font-semibold text-right">Cổng Purge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141d33]">
            {loading && filteredItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Đang kiểm tra danh mục phiên bản dataset &amp; artifacts...
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  {source === 'api'
                    ? 'Không có dataset hoặc artifact nào khớp bộ lọc.'
                    : 'Chưa có dữ liệu phiên bản được xác minh từ Backend (trạng thái UNVERIFIED).'}
                </td>
              </tr>
            ) : (
              filteredItems.map((item, idx) => {
                const integrityStatus =
                  item.integrity?.status || ARTIFACT_INTEGRITY_STATUS.UNVERIFIED;
                const integrityReason = item.integrity?.reasons?.[0] || null;
                const purgeAllowed = Boolean(item.purgeGuard?.allowed);
                const purgeReason = item.purgeGuard?.reasons?.[0] || 'Đang được bảo vệ bởi retention.';

                return (
                  <tr
                    key={item.id || `${item.objectKey}-${idx}`}
                    className="hover:bg-[#10192e]/70 transition"
                  >
                    <td className="py-3 px-4 max-w-[340px] xl:max-w-[460px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-100 truncate" title={item.name}>
                          {item.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[#13203d] text-[#38bdf8] text-[10px] font-semibold whitespace-nowrap shrink-0">
                          {TYPE_LABELS[item.artifactType] || item.artifactType}
                        </span>
                      </div>
                      <div
                        className="text-[11px] text-slate-400 font-mono truncate mt-0.5"
                        title={item.objectKey || 'Thiếu objectKey'}
                      >
                        {item.objectKey || '— (Thiếu objectKey)'}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">
                        {formatBytes(item.sizeBytes)}
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-100 font-semibold">
                          {item.version ? `v${item.version}` : '—'}
                        </span>
                        {item.baselineComparison?.comparable && (
                          <span
                            title={item.baselineComparison.summary}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-semibold border ${
                              item.baselineComparison.matchesBaseline
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {item.baselineComparison.matchesBaseline
                              ? 'Khớp Baseline'
                              : 'Lệch Baseline'}
                          </span>
                        )}
                      </div>
                      {item.parentVersion && (
                        <div className="text-[10px] text-slate-400">
                          từ v{item.parentVersion}
                        </div>
                      )}
                      <div
                        className="text-[10px] text-slate-500 mt-0.5"
                        title={item.checksumSha256 || 'Chưa có SHA-256'}
                      >
                        SHA: {shortHash(item.checksumSha256)}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-[11px] text-slate-300">
                      <div className="truncate max-w-[200px] xl:max-w-[280px]" title={item.sourceRef || ''}>
                        {item.sourceRef || '—'}
                      </div>
                      {item.linkedJobId && (
                        <div className="text-[10px] font-mono text-slate-500 whitespace-nowrap">
                          Job: {item.linkedJobId}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap border ${
                          INTEGRITY_BADGES[integrityStatus] || INTEGRITY_BADGES.UNVERIFIED
                        }`}
                      >
                        {integrityStatus}
                      </span>
                      {integrityReason && (
                        <div className="text-[10px] text-slate-400 mt-1 max-w-[240px] xl:max-w-[320px] leading-snug">
                          {integrityReason}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-[11px] whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            LIFECYCLE_BADGES[item.lifecycleStatus] || LIFECYCLE_BADGES.ACTIVE
                          }`}
                        >
                          {item.lifecycleStatus}
                        </span>
                        {item.legalHold && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/35">
                            Legal Hold
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        Retain: {formatDateTime(item.retainUntil)}
                      </div>
                      {item.purgeAt && (
                        <div className="text-[10px] text-amber-300">
                          Purge: {formatDateTime(item.purgeAt)}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <span
                        title={purgeAllowed ? 'Đủ điều kiện retention để purge' : purgeReason}
                        className={`inline-block px-3 py-1.5 rounded-lg border text-[10px] font-semibold whitespace-nowrap ${
                          purgeAllowed
                            ? 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                            : 'border-[#24365c] bg-[#090f1d] text-slate-400'
                        }`}
                      >
                        {purgeAllowed ? 'Đủ điều kiện Purge' : 'Đang khóa bảo vệ'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

