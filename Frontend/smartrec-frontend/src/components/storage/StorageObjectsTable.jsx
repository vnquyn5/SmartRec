import React, { useState } from 'react';
import {
  STORAGE_STATUSES,
  formatBytes,
  formatDateTime,
} from '../../services/storageAdminService';
import ArtifactVersionPanel from './ArtifactVersionPanel';

const STATUS_BADGES = {
  UPLOADED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
  TRASHED: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
  UPLOADING: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
  INTEGRITY_FAILED: 'bg-rose-500/15 text-rose-300 border-rose-500/35',
  PURGED: 'bg-slate-500/15 text-slate-300 border-slate-500/35',
};

export default function StorageObjectsTable({
  objectsPage,
  orphans,
  artifactState,
  loadingArtifacts,
  onRefreshArtifacts,
  filters,
  loadingObjects,
  loadingOrphans,
  deletingId,
  deletingOrphans,
  onFiltersChange,
  onDeleteObject,
  onDeleteOrphans,
}) {
  const [subTab, setSubTab] = useState('media');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [forceChecked, setForceChecked] = useState(false);
  const [selectedOrphanKeys, setSelectedOrphanKeys] = useState([]);

  const rows = objectsPage?.content || [];
  const totalPages = Math.max(1, objectsPage?.totalPages || 1);
  const currentPage = objectsPage?.page || 0;
  const totalElements = objectsPage?.totalElements || 0;

  const orphanList = orphans || [];
  const allOrphansSelected =
    orphanList.length > 0 && selectedOrphanKeys.length === orphanList.length;

  const openDeletePrompt = (item) => {
    setForceChecked(false);
    setPendingDelete({
      id: item.id,
      name: item.originalName,
      objectKey: item.objectKey,
      requiresForceHint: item.hasLinkedMeeting || item.status === 'UPLOADING',
      reason: item.hasLinkedMeeting
        ? 'File đang liên kết với cuộc họp — cần Force Delete để xóa cả Meeting.'
        : item.status === 'UPLOADING'
          ? 'File đang ở trạng thái UPLOADING — cần Force Delete để xóa cưỡng bức.'
          : null,
    });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const mustForce = pendingDelete.requiresForceHint ? forceChecked : false;
    const ok = await onDeleteObject(pendingDelete.id, mustForce);
    if (ok) {
      setPendingDelete(null);
      setForceChecked(false);
    }
  };

  const toggleOrphanKey = (key) => {
    setSelectedOrphanKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const toggleAllOrphans = () => {
    if (allOrphansSelected) {
      setSelectedOrphanKeys([]);
    } else {
      setSelectedOrphanKeys(orphanList.map((item) => item.objectKey));
    }
  };

  const handleBulkDeleteOrphans = async () => {
    if (selectedOrphanKeys.length === 0) return;
    const ok = await onDeleteOrphans(selectedOrphanKeys);
    if (ok) {
      setSelectedOrphanKeys([]);
    }
  };

  return (
    <div className="w-full min-w-0 rounded-2xl border border-[#1b2640] bg-[#0c1324] px-3 py-4 sm:px-4 sm:py-5 flex flex-col gap-4">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="inline-flex flex-wrap sm:flex-nowrap items-center gap-1 rounded-xl bg-[#090f1d] border border-[#1b2742] p-1">
            <button
              type="button"
              onClick={() => setSubTab('media')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition ${
                subTab === 'media'
                  ? 'bg-[#2563eb] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Media Files ({totalElements})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('orphans')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition ${
                subTab === 'orphans'
                  ? 'bg-[#2563eb] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              MinIO Orphan Objects ({orphanList.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('artifacts')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition ${
                subTab === 'artifacts'
                  ? 'bg-[#2563eb] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Dataset &amp; Artifacts ({artifactState?.snapshot?.counts?.total ?? 0})
            </button>
          </div>
        </div>

        {subTab === 'orphans' && (
          <div className="flex items-center justify-end shrink-0">
            <button
              type="button"
              disabled={selectedOrphanKeys.length === 0 || deletingOrphans}
              onClick={handleBulkDeleteOrphans}
              className="px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition"
            >
              {deletingOrphans
                ? 'Đang xóa...'
                : `Xóa đã chọn (${selectedOrphanKeys.length})`}
            </button>
          </div>
        )}

        {subTab === 'media' && (
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full xl:w-auto xl:flex-1 xl:justify-end">
            <input
              type="text"
              value={filters.keyword}
              onChange={(e) =>
                onFiltersChange((prev) => ({ ...prev, keyword: e.target.value, page: 0 }))
              }
              placeholder="Tìm tên file hoặc object_key..."
              className="flex-1 min-w-[200px] xl:max-w-xs px-3.5 py-2 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
            />

            <select
              value={filters.status}
              onChange={(e) =>
                onFiltersChange((prev) => ({ ...prev, status: e.target.value, page: 0 }))
              }
              aria-label="Lọc trạng thái file"
              className="px-3 py-2 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-slate-200 whitespace-nowrap shrink-0 focus:outline-none focus:border-[#38bdf8]"
            >
              {STORAGE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st === 'ALL' ? 'Tất cả trạng thái' : st}
                </option>
              ))}
            </select>

            <select
              value={filters.sort}
              onChange={(e) =>
                onFiltersChange((prev) => ({ ...prev, sort: e.target.value, page: 0 }))
              }
              aria-label="Sắp xếp file"
              className="px-3 py-2 rounded-xl bg-[#090f1d] border border-[#1b2742] text-xs text-slate-200 whitespace-nowrap shrink-0 focus:outline-none focus:border-[#38bdf8]"
            >
              <option value="created_at,desc">Mới nhất</option>
              <option value="file_size_bytes,desc">Dung lượng giảm dần</option>
              <option value="file_size_bytes,asc">Dung lượng tăng dần</option>
              <option value="original_name,asc">Tên A → Z</option>
            </select>
          </div>
        )}
      </div>

      {pendingDelete && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex flex-col gap-1.5">
            <span className="text-rose-200 font-semibold">
              Xác nhận xóa vĩnh viễn: {pendingDelete.name}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">{pendingDelete.objectKey}</span>
            {pendingDelete.requiresForceHint && (
              <label className="inline-flex items-center gap-2 text-amber-200 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={forceChecked}
                  onChange={(e) => setForceChecked(e.target.checked)}
                  className="rounded border-amber-400"
                />
                <span>{pendingDelete.reason}</span>
              </label>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:text-white"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={
                Boolean(deletingId) ||
                (pendingDelete.requiresForceHint && !forceChecked)
              }
              onClick={confirmDelete}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold"
            >
              {deletingId === pendingDelete.id ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
            </button>
          </div>
        </div>
      )}

      {subTab === 'media' ? (
        <>
          <div className="w-full overflow-x-auto rounded-xl border border-[#162038]">
            <table className="w-full min-w-[880px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#090f1d] text-slate-400 border-b border-[#162038] whitespace-nowrap">
                  <th className="py-3 px-4 font-semibold">File &amp; Object Key</th>
                  <th className="py-3 px-4 font-semibold">Uploader</th>
                  <th className="py-3 px-4 font-semibold">MIME</th>
                  <th className="py-3 px-4 font-semibold text-right">Dung lượng</th>
                  <th className="py-3 px-4 font-semibold">Trạng thái</th>
                  <th className="py-3 px-4 font-semibold">Ngày tạo / Purge</th>
                  <th className="py-3 px-4 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141d33]">
                {loadingObjects && rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Đang tải danh sách MediaFile...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Không tìm thấy file nào khớp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  rows.map((item) => (
                    <tr key={item.id} className="hover:bg-[#10192e]/70 transition">
                      <td className="py-3 px-4 min-w-[240px] max-w-[380px] xl:max-w-[500px]">
                        <div className="font-medium text-slate-100 truncate" title={item.originalName}>
                          {item.originalName}
                        </div>
                        <div
                          className="text-[11px] text-slate-400 font-mono truncate"
                          title={item.objectKey}
                        >
                          {item.objectKey}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="text-slate-200">{item.uploaderName || '—'}</div>
                        <div className="text-[11px] text-slate-500">{item.uploaderEmail || item.uploadedBy}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                        {item.mimeType}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-100 whitespace-nowrap">
                        {formatBytes(item.fileSizeBytes)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${
                              STATUS_BADGES[item.status] || STATUS_BADGES.PURGED
                            }`}
                          >
                            {item.status}
                          </span>
                          {item.hasLinkedMeeting && (
                            <span className="text-[10px] text-[#38bdf8] whitespace-nowrap">
                              Linked Meeting
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-400 whitespace-nowrap">
                        <div>{formatDateTime(item.createdAt)}</div>
                        {item.purgeAt && (
                          <div className="text-amber-300">Purge: {formatDateTime(item.purgeAt)}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={deletingId === item.id}
                          onClick={() => openDeletePrompt(item)}
                          className="px-3 py-1.5 rounded-lg border border-rose-500/35 text-rose-300 hover:bg-rose-500/15 disabled:opacity-45 text-[11px] font-medium whitespace-nowrap transition"
                        >
                          {deletingId === item.id ? 'Đang xóa...' : 'Xóa'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-400">
            <span>
              Trang {currentPage + 1} / {totalPages} · Tổng {totalElements} files
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={currentPage <= 0}
                onClick={() =>
                  onFiltersChange((prev) => ({ ...prev, page: Math.max(0, prev.page - 1) }))
                }
                className="px-3.5 py-1.5 rounded-lg border border-[#1b2742] bg-[#090f1d] text-slate-200 whitespace-nowrap disabled:opacity-40"
              >
                Trước
              </button>
              <button
                type="button"
                disabled={currentPage + 1 >= totalPages}
                onClick={() => onFiltersChange((prev) => ({ ...prev, page: prev.page + 1 }))}
                className="px-3.5 py-1.5 rounded-lg border border-[#1b2742] bg-[#090f1d] text-slate-200 whitespace-nowrap disabled:opacity-40"
              >
                Sau
              </button>
            </div>
          </div>
        </>
      ) : subTab === 'artifacts' ? (
        <ArtifactVersionPanel
          snapshot={artifactState?.snapshot}
          source={artifactState?.source}
          loading={loadingArtifacts}
          error={artifactState?.error}
          onRefresh={onRefreshArtifacts}
        />
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-[#162038]">
          <table className="w-full min-w-[840px] text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#090f1d] text-slate-400 border-b border-[#162038] whitespace-nowrap">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={allOrphansSelected}
                    onChange={toggleAllOrphans}
                    aria-label="Chọn tất cả orphan object"
                  />
                </th>
                <th className="py-3 px-4 font-semibold">MinIO Object Key</th>
                <th className="py-3 px-4 font-semibold">ETag</th>
                <th className="py-3 px-4 font-semibold text-right">Dung lượng</th>
                <th className="py-3 px-4 font-semibold">Cập nhật cuối</th>
                <th className="py-3 px-4 font-semibold text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141d33]">
              {loadingOrphans && orphanList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Đang quét bucket MinIO...
                  </td>
                </tr>
              ) : orphanList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-emerald-300">
                    Không có orphan object nào trên MinIO bucket.
                  </td>
                </tr>
              ) : (
                orphanList.map((orphan) => (
                  <tr key={orphan.objectKey} className="hover:bg-[#10192e]/70 transition">
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selectedOrphanKeys.includes(orphan.objectKey)}
                        onChange={() => toggleOrphanKey(orphan.objectKey)}
                        aria-label={`Chọn ${orphan.objectKey}`}
                      />
                    </td>
                    <td
                      className="py-3 px-4 font-mono text-slate-200 max-w-[420px] xl:max-w-[580px] truncate"
                      title={orphan.objectKey}
                    >
                      {orphan.objectKey}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {orphan.etag || '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-rose-300 whitespace-nowrap">
                      {formatBytes(orphan.sizeBytes)}
                    </td>
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                      {formatDateTime(orphan.lastModified)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={deletingOrphans}
                        onClick={() => onDeleteOrphans([orphan.objectKey])}
                        className="px-3 py-1.5 rounded-lg border border-rose-500/35 text-rose-300 hover:bg-rose-500/15 disabled:opacity-45 text-[11px] whitespace-nowrap transition"
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

