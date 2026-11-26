import React, { useCallback, useEffect, useState } from 'react';
import StorageOverviewCards from '../../components/storage/StorageOverviewCards';
import StorageGrowthAlertPanel from '../../components/storage/StorageGrowthAlertPanel';
import StorageChartsPanel from '../../components/storage/StorageChartsPanel';
import StorageCleanupPanel from '../../components/storage/StorageCleanupPanel';
import StorageObjectsTable from '../../components/storage/StorageObjectsTable';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  evaluateArtifactRegistrySnapshot,
  getArtifactVersionsRegistry,
} from '../../services/artifactRetentionService';
import {
  deleteOrphanObjects,
  deleteStorageObject,
  getOrphanObjects,
  getStorageObjects,
  getStorageOverview,
  resetStorageMockState,
  runStorageCleanup,
} from '../../services/storageAdminService';

const DEFAULT_FILTERS = {
  status: 'ALL',
  keyword: '',
  sort: 'created_at,desc',
  page: 0,
  size: 8,
};

export default function StorageAdminPage() {
  const { user } = useAuth() || {};
  const [overview, setOverview] = useState(null);
  const [objectsPage, setObjectsPage] = useState(null);
  const [orphans, setOrphans] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [artifactState, setArtifactState] = useState(() => ({
    source: 'unverified',
    snapshot: evaluateArtifactRegistrySnapshot(null),
    error: null,
  }));
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);

  const [dataSource, setDataSource] = useState('api');
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingObjects, setLoadingObjects] = useState(true);
  const [loadingOrphans, setLoadingOrphans] = useState(true);
  const [runningTask, setRunningTask] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deletingOrphans, setDeletingOrphans] = useState(false);

  const [lastCleanupResult, setLastCleanupResult] = useState(null);
  const [notice, setNotice] = useState({ type: '', message: '' });

  const showNotice = useCallback((type, message) => {
    setNotice({ type, message });
    if (type === 'success') {
      setTimeout(() => {
        setNotice((prev) => (prev.message === message ? { type: '', message: '' } : prev));
      }, 3500);
    }
  }, []);

  const loadOverviewAndOrphans = useCallback(async () => {
    setLoadingOverview(true);
    setLoadingOrphans(true);
    try {
      const [ovRes, orphRes] = await Promise.all([
        getStorageOverview(),
        getOrphanObjects(),
      ]);
      setOverview(ovRes.data);
      setOrphans(orphRes.data);
      setDataSource(ovRes.source);
    } catch (err) {
      showNotice('error', err?.response?.data?.message || 'Không thể tải tổng quan Storage');
    } finally {
      setLoadingOverview(false);
      setLoadingOrphans(false);
    }
  }, [showNotice]);

  const loadObjects = useCallback(async () => {
    setLoadingObjects(true);
    try {
      const res = await getStorageObjects(filters);
      setObjectsPage(res.data);
      setDataSource(res.source);
    } catch (err) {
      showNotice('error', err?.response?.data?.message || 'Không thể tải danh sách file');
    } finally {
      setLoadingObjects(false);
    }
  }, [filters, showNotice]);

  const loadArtifactVersions = useCallback(async () => {
    setLoadingArtifacts(true);
    try {
      const result = await getArtifactVersionsRegistry({ user });
      setArtifactState(result);
    } finally {
      setLoadingArtifacts(false);
    }
  }, [user]);

  useEffect(() => {
    loadOverviewAndOrphans();
    loadArtifactVersions();
  }, [loadOverviewAndOrphans, loadArtifactVersions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadObjects();
    }, 180);
    return () => clearTimeout(timer);
  }, [loadObjects]);

  const refreshAll = async () => {
    await Promise.all([loadOverviewAndOrphans(), loadObjects(), loadArtifactVersions()]);
  };

  const handleRunCleanup = async (taskType) => {
    setRunningTask(taskType);
    try {
      const res = await runStorageCleanup(taskType);
      setLastCleanupResult(res.data);
      showNotice('success', res.data.message);
      await refreshAll();
    } catch (err) {
      showNotice('error', err?.response?.data?.message || 'Chạy tác vụ dọn dẹp thất bại');
    } finally {
      setRunningTask(null);
    }
  };

  const handleDeleteObject = async (mediaFileId, force) => {
    setDeletingId(mediaFileId);
    try {
      await deleteStorageObject(mediaFileId, force);
      showNotice('success', 'Đã xóa vĩnh viễn MediaFile khỏi MinIO và Database.');
      await refreshAll();
      return true;
    } catch (err) {
      showNotice(
        'error',
        err?.response?.data?.message || 'Không thể xóa MediaFile (kiểm tra ràng buộc Meeting hoặc quyền truy cập).'
      );
      return false;
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteOrphans = async (objectKeys) => {
    setDeletingOrphans(true);
    try {
      const res = await deleteOrphanObjects(objectKeys);
      setLastCleanupResult(res.data);
      showNotice('success', res.data.message);
      await loadOverviewAndOrphans();
      return true;
    } catch (err) {
      showNotice('error', err?.response?.data?.message || 'Không thể xóa orphan object trên MinIO.');
      return false;
    } finally {
      setDeletingOrphans(false);
    }
  };

  const handleResetDemo = async () => {
    resetStorageMockState();
    setLastCleanupResult(null);
    showNotice('success', 'Đã khôi phục dữ liệu demo Storage mặc định.');
    await refreshAll();
  };

  const minioHealthy = overview?.minioConnected && overview?.bucketHealthy;

  return (
    <div className="min-h-full w-full bg-[#070b19] text-slate-100 pb-6 flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#162038] pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              SmartRec Storage Engine
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#13203d] text-[#38bdf8] border border-[#243b6b]">
              Bucket: {overview?.bucketName || 'smartrec-media'}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                minioHealthy
                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40'
                  : 'bg-amber-950/50 text-amber-300 border-amber-500/40'
              }`}
            >
              MinIO: {minioHealthy ? 'Healthy' : 'Offline / Degraded'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#0d152a] text-slate-300 border border-[#1d2a49]">
              {dataSource === 'api' ? 'Live API' : 'Local Mock Mode'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Giám sát dung lượng PostgreSQL &amp; MinIO bucket, phát hiện orphan objects và vận hành tác vụ dọn rác lưu trữ.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          {dataSource === 'local' && (
            <button
              type="button"
              onClick={handleResetDemo}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-[#1d2a49] bg-[#0b1222] text-slate-300 hover:text-white transition"
            >
              Reset Demo Data
            </button>
          )}
          <button
            type="button"
            onClick={refreshAll}
            disabled={loadingOverview || loadingObjects}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#13203d] hover:bg-[#1a2b50] text-[#38bdf8] border border-[#243b6b] disabled:opacity-50 transition"
          >
            {loadingOverview || loadingObjects ? 'Đang làm mới...' : 'Làm mới dữ liệu'}
          </button>
        </div>
      </div>

      {notice.message && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs ${
            notice.type === 'error'
              ? 'bg-rose-950/35 border-rose-500/40 text-rose-300'
              : 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
          }`}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice({ type: '', message: '' })}
            className="opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      <StorageOverviewCards overview={overview} loading={loadingOverview} />

      <StorageGrowthAlertPanel
        overview={overview}
        orphans={orphans}
        loading={loadingOverview || loadingOrphans}
        dataSource={dataSource}
        user={user}
      />

      <StorageChartsPanel overview={overview} />

      <StorageCleanupPanel
        overview={overview}
        runningTask={runningTask}
        lastCleanupResult={lastCleanupResult}
        onRunCleanup={handleRunCleanup}
      />

      <StorageObjectsTable
        objectsPage={objectsPage}
        orphans={orphans}
        artifactState={artifactState}
        loadingArtifacts={loadingArtifacts}
        onRefreshArtifacts={loadArtifactVersions}
        filters={filters}
        loadingObjects={loadingObjects}
        loadingOrphans={loadingOrphans}
        deletingId={deletingId}
        deletingOrphans={deletingOrphans}
        onFiltersChange={setFilters}
        onDeleteObject={handleDeleteObject}
        onDeleteOrphans={handleDeleteOrphans}
      />
    </div>
  );
}

