import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/layout/DashboardLayout.jsx";
import Pagination from "../../components/common/Pagination.jsx";
import {
  DownloadIcon,
  EyeIcon,
  FilterIcon,
  FolderPlusIcon,
  MoveIcon,
  PencilIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  ShareIcon,
  TrashIcon,
} from "../../components/common/icons.jsx";
import DeleteMeetingModal from "../../components/meeting/DeleteMeetingModal.jsx";
import MeetingStatusBadge from "../../components/meeting/MeetingStatusBadge.jsx";
import { MEETING_STATUS } from "../../types/meeting.js";
import {
  deleteMeeting,
  getMeetings,
  renameMeeting as renameMeetingApi,
} from "../../services/meetingService.js";

const EMPTY_PAGE = {
  content: [],
  pageNumber: 0,
  pageSize: 10,
  totalElements: 0,
  totalPages: 0,
  first: true,
  last: true,
};
const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "--";
const shortId = (value) => (value ? `${value.slice(0, 8)}...` : "--");
const getExtension = (value) => {
  const lastDot = value.lastIndexOf(".");
  return lastDot > 0 ? value.slice(lastDot) : "";
};
const getBaseName = (value) =>
  value.slice(0, value.length - getExtension(value).length);
const formatBytes = (value) => {
  if (!value) return "0 B";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024).toFixed(1)} KB`;
};

export default function FileManagerPage() {
  const [data, setData] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [actionMessage, setActionMessage] = useState("");
  const [renameMeeting, setRenameMeeting] = useState(null);
  const [renameBaseName, setRenameBaseName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [infoMeeting, setInfoMeeting] = useState(null);
  const [shareMeeting, setShareMeeting] = useState(null);
  const [shareCopied, setShareCopied] = useState(false);
  const navigate = useNavigate();

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(
        await getMeetings({ page, size: 10, status, keyword: keyword.trim() }),
      );
    } catch (requestError) {
      setError(requestError?.message || "Không thể tải danh sách file.");
    } finally {
      setLoading(false);
    }
  }, [keyword, page, status]);

  useEffect(() => {
    const timer = window.setTimeout(loadMeetings, keyword ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [loadMeetings, keyword]);
  const handleSearchChange = (event) => {
    setKeyword(event.target.value);
    setPage(0);
  };
  const handleStatusChange = (event) => {
    setStatus(event.target.value);
    setPage(0);
  };

  const toggleMeeting = (meetingId) => {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(meetingId)) nextIds.delete(meetingId);
      else nextIds.add(meetingId);
      return nextIds;
    });
  };

  const visibleIds = data.content.map((meeting) => meeting.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleAllVisible = () => {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (allVisibleSelected) visibleIds.forEach((id) => nextIds.delete(id));
      else visibleIds.forEach((id) => nextIds.add(id));
      return nextIds;
    });
  };

  const handleCreateFolder = () => {
    setActionMessage(
      "Tạo thư mục sẽ được kết nối khi backend cung cấp API thư mục.",
    );
  };

  const handleMoveSelected = () => {
    setActionMessage(
      `Đã chọn ${selectedIds.size} tệp. Chức năng di chuyển sẽ được kết nối khi có API thư mục.`,
    );
  };

  const openRename = (meeting) => {
    const currentName = meeting.fileName || meeting.title || "File cuộc họp";
    setRenameMeeting(meeting);
    setRenameBaseName(getBaseName(currentName));
    setRenameError("");
  };

  const handleRename = async () => {
    const nextBaseName = renameBaseName.trim();
    if (!renameMeeting) return;
    if (!nextBaseName) {
      setRenameError("Vui lòng nhập tên file.");
      return;
    }

    const currentName =
      renameMeeting.fileName || renameMeeting.title || "File cuộc họp";
    const nextName = `${nextBaseName}${getExtension(currentName)}`;
    setIsRenaming(true);
    setRenameError("");
    try {
      const updatedMeeting = await renameMeetingApi(renameMeeting.id, nextName);
      setData((currentData) => ({
        ...currentData,
        content: currentData.content.map((meeting) =>
          meeting.id === renameMeeting.id ? updatedMeeting : meeting,
        ),
      }));
      setRenameMeeting(null);
      setActionMessage(
        `Đã đổi tên tệp thành “${updatedMeeting.fileName || nextName}”.`,
      );
    } catch (requestError) {
      setRenameError(
        requestError?.message ||
          "Không thể cập nhật tên file. Vui lòng thử lại.",
      );
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDownload = (meeting) => {
    const downloadUrl =
      meeting.downloadUrl || meeting.fileUrl || meeting.objectUrl;
    if (!downloadUrl) {
      setActionMessage("Backend chưa trả về URL tải xuống cho tệp này.");
      return;
    }

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = meeting.fileName || meeting.title || "meeting-file";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.click();
  };

  const openShare = (meeting) => {
    setShareMeeting(meeting);
    setShareCopied(false);
  };

  const getShareUrl = (meeting) =>
    `${window.location.origin}/meeting/${meeting.id}`;

  const copyShareUrl = async () => {
    if (!shareMeeting) return;
    try {
      await navigator.clipboard.writeText(getShareUrl(shareMeeting));
      setShareCopied(true);
    } catch {
      setActionMessage("Không thể sao chép link. Vui lòng sao chép thủ công.");
    }
  };

  const visibleBytes = data.content.reduce(
    (total, meeting) => total + (Number(meeting.fileSizeBytes) || 0),
    0,
  );

  const handleDelete = async () => {
    if (!selectedMeeting) return;
    setIsDeleting(true);
    try {
      await deleteMeeting(selectedMeeting.id);
      setSelectedMeeting(null);
      setSelectedIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(selectedMeeting.id);
        return nextIds;
      });
      if (data.content.length === 1 && page > 0)
        setPage((currentPage) => currentPage - 1);
      else await loadMeetings();
    } catch (requestError) {
      setError(requestError?.message || "Không thể xóa file.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1180px] space-y-5">
        <header>
          <h1 className="text-[27px] font-extrabold leading-tight tracking-tight text-white">
            Danh sách cuộc họp
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Xem danh sách các file cuộc họp đã tải lên trong không gian cá nhân
          </p>
        </header>
        <section className="grid gap-3 md:grid-cols-3">
          <div className="flex min-h-[104px] items-center gap-4 rounded-xl border border-white/5 bg-[#101624] px-4 py-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              ▰
            </span>
            <div>
              <p className="text-[11px] text-slate-500">Tổng số file</p>
              <strong className="mt-1 block text-xl text-white">
                {data.totalElements}
              </strong>
            </div>
            <span className="ml-auto self-start rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
              +9%
            </span>
          </div>
          <div className="flex min-h-[104px] items-center gap-4 rounded-xl border border-white/5 bg-[#101624] px-4 py-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              ▤
            </span>
            <div>
              <p className="text-[11px] text-slate-500">Dung lượng đã dùng</p>
              <strong className="mt-1 block text-xl text-white">
                {formatBytes(visibleBytes)}{" "}
                <span className="text-xs font-normal text-slate-500">
                  / 50GB
                </span>
              </strong>
            </div>
          </div>
          <div className="flex min-h-[104px] items-center gap-4 rounded-xl border border-white/5 bg-[#101624] px-4 py-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
              ϟ
            </span>
            <div>
              <p className="text-[11px] text-slate-500">Đang xử lý AI</p>
              <strong className="mt-1 block text-xl text-white">
                {
                  data.content.filter(
                    (meeting) => meeting.status === MEETING_STATUS.PROCESSING,
                  ).length
                }
              </strong>
              <span className="text-[10px] text-slate-600">
                trên trang hiện tại
              </span>
            </div>
            <span className="ml-auto self-start rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
              +
              {
                data.content.filter(
                  (meeting) => meeting.status === MEETING_STATUS.FAILED,
                ).length
              }
            </span>
          </div>
        </section>
        <section className="overflow-hidden rounded-xl border border-white/5 bg-[#101624] shadow-xl shadow-black/10">
          <div className="flex flex-col gap-3 border-b border-white/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-[235px]">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
              <input
                value={keyword}
                onChange={handleSearchChange}
                placeholder="Tìm kiếm file..."
                className="w-full rounded-lg border border-slate-800 bg-[#171d31] py-2 pl-9 pr-3 text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate("/upload")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[11px] font-semibold text-blue-400 transition hover:bg-blue-500/20 hover:text-white"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Tải lên file
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#171d31] px-2.5 py-2 text-[11px] font-medium text-slate-300 transition hover:border-blue-500/50 hover:text-white"
              >
                <FolderPlusIcon />
                Tạo thư mục
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={handleMoveSelected}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#171d31] px-2.5 py-2 text-[11px] font-medium text-slate-300 transition hover:border-blue-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MoveIcon />
                Di chuyển{selectedIds.size > 0 && ` (${selectedIds.size})`}
              </button>
              <FilterIcon className="h-3.5 w-3.5 text-slate-600" />
              <select
                value={status}
                onChange={handleStatusChange}
                className="rounded-lg border border-slate-800 bg-[#171d31] px-2.5 py-2 text-[11px] text-slate-400 outline-none focus:border-blue-500/60"
              >
                <option value="">Tất cả trạng thái</option>
                <option value="PENDING">Chưa xử lý</option>
                <option value="PROCESSING">Đang xử lý</option>
                <option value="COMPLETED">Hoàn tất</option>
                <option value="FAILED">Lỗi</option>
              </select>
              <button
                type="button"
                title="Tải lại"
                onClick={loadMeetings}
                className="rounded-lg border border-slate-800 p-2 text-slate-500 transition hover:border-slate-600 hover:text-white"
              >
                <RefreshIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {actionMessage && (
            <div className="mx-4 mb-3 flex items-center justify-between rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
              <span>{actionMessage}</span>
              <button
                type="button"
                onClick={() => setActionMessage("")}
                className="ml-3 text-blue-300 hover:text-white"
                aria-label="Đóng thông báo"
              >
                ×
              </button>
            </div>
          )}
          {error && (
            <div className="mx-4 mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="border-y border-white/5 bg-white/[0.015] text-[10px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Chọn tất cả tệp trên trang"
                      className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 accent-blue-500"
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">File</th>
                  <th className="px-5 py-3 font-medium">Kích thước</th>
                  <th className="px-5 py-3 font-medium">Ngày tải lên</th>
                  <th className="px-5 py-3 font-medium">Trạng thái</th>
                  <th className="px-5 py-3 text-right font-medium">
                    Hành động
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading
                  ? Array.from({ length: 5 }, (_, index) => (
                      <tr key={index}>
                        <td colSpan="6" className="px-5 py-5">
                          <div className="h-4 animate-pulse rounded bg-slate-800" />
                        </td>
                      </tr>
                    ))
                  : data.content.map((meeting) => (
                      <tr
                        key={meeting.id}
                        className="transition hover:bg-blue-500/[0.03]"
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(meeting.id)}
                            onChange={() => toggleMeeting(meeting.id)}
                            aria-label={`Chọn ${meeting.fileName || meeting.title || "file"}`}
                            className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 accent-blue-500"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-200">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                              ▰
                            </span>
                            <div className="min-w-0">
                              <div className="truncate">
                                {meeting.fileName ||
                                  meeting.title ||
                                  "File không tên"}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-[10px] text-slate-600">
                                {shortId(meeting.mediaFileId)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {meeting.fileSizeBytes
                            ? `${(meeting.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
                            : "--"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                          {formatDate(meeting.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <MeetingStatusBadge status={meeting.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              title="Xem"
                              onClick={() => setInfoMeeting(meeting)}
                              className="rounded p-1.5 text-slate-600 transition hover:bg-white/5 hover:text-slate-200"
                            >
                              <EyeIcon />
                            </button>
                            <button
                              type="button"
                              title="Tải xuống"
                              onClick={() => handleDownload(meeting)}
                              className="rounded p-1.5 text-slate-600 transition hover:bg-white/5 hover:text-slate-200"
                            >
                              <DownloadIcon />
                            </button>
                            <button
                              type="button"
                              title="Chia sẻ"
                              onClick={() => openShare(meeting)}
                              className="rounded p-1.5 text-slate-600 transition hover:bg-white/5 hover:text-slate-200"
                            >
                              <ShareIcon />
                            </button>
                            <button
                              type="button"
                              title="Xóa file"
                              onClick={() => setSelectedMeeting(meeting)}
                              className="rounded p-1.5 text-slate-600 transition hover:bg-red-500/10 hover:text-red-300"
                            >
                              <TrashIcon />
                            </button>
                            <button
                              type="button"
                              title="Đổi tên tệp"
                              onClick={() => openRename(meeting)}
                              className="rounded p-1.5 text-slate-600 transition hover:bg-blue-500/10 hover:text-blue-300"
                            >
                              <PencilIcon />
                            </button>
                            <button
                              type="button"
                              title="Đưa vào Workspace"
                              onClick={() =>
                                setActionMessage(
                                  `Đã chọn “${meeting.fileName || meeting.title || "tệp"}” để đưa vào quy trình Workspace.`,
                                )
                              }
                              className="rounded p-1.5 text-slate-600 transition hover:bg-emerald-500/10 hover:text-emerald-300"
                            >
                              <PlayIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                {!loading && data.content.length === 0 && (
                  <tr>
                    <td
                      colSpan="6"
                      className="px-5 py-16 text-center text-sm text-slate-500"
                    >
                      Không tìm thấy file phù hợp.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={data.pageNumber}
            totalPages={data.totalPages}
            totalElements={data.totalElements}
            pageSize={data.pageSize}
            onPageChange={setPage}
          />
        </section>
      </div>
      <DeleteMeetingModal
        open={Boolean(selectedMeeting)}
        title={selectedMeeting?.fileName || selectedMeeting?.title}
        loading={isDeleting}
        onClose={() => setSelectedMeeting(null)}
        onConfirm={handleDelete}
      />
      {infoMeeting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setInfoMeeting(null)
          }
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#101624] p-6 shadow-2xl shadow-black/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-info-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Thông tin lưu trong CSDL
                </p>
                <h2
                  id="meeting-info-title"
                  className="mt-1 break-words text-lg font-bold text-white"
                >
                  {infoMeeting.fileName || infoMeeting.title || "File cuộc họp"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setInfoMeeting(null)}
                className="text-xl leading-none text-slate-500 hover:text-white"
                aria-label="Đóng"
              >
                ×
              </button>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Meeting ID</dt>
                <dd className="mt-1 break-all font-mono text-slate-200">
                  {infoMeeting.id || "--"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Media file ID</dt>
                <dd className="mt-1 break-all font-mono text-slate-200">
                  {infoMeeting.mediaFileId || "--"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Trạng thái</dt>
                <dd className="mt-1">
                  <MeetingStatusBadge status={infoMeeting.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">MIME type</dt>
                <dd className="mt-1 text-slate-200">
                  {infoMeeting.mimeType || "--"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Dung lượng</dt>
                <dd className="mt-1 text-slate-200">
                  {formatBytes(Number(infoMeeting.fileSizeBytes) || 0)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Thời lượng</dt>
                <dd className="mt-1 text-slate-200">
                  {infoMeeting.durationSeconds
                    ? `${infoMeeting.durationSeconds}s`
                    : "--"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Ngày tạo</dt>
                <dd className="mt-1 text-slate-200">
                  {formatDate(infoMeeting.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Cập nhật</dt>
                <dd className="mt-1 text-slate-200">
                  {formatDate(infoMeeting.updatedAt)}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setInfoMeeting(null)}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
      {shareMeeting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setShareMeeting(null)
          }
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#101624] p-6 shadow-2xl shadow-black/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-meeting-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Chia sẻ cuộc họp
                </p>
                <h2
                  id="share-meeting-title"
                  className="mt-1 text-lg font-bold text-white"
                >
                  Link chia sẻ file
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShareMeeting(null)}
                className="text-xl leading-none text-slate-500 hover:text-white"
                aria-label="Đóng"
              >
                ×
              </button>
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-lg border border-slate-700 bg-[#171d31] p-2">
              <input
                readOnly
                value={getShareUrl(shareMeeting)}
                className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-300 outline-none"
                aria-label="Link chia sẻ"
              />
              <button
                type="button"
                onClick={copyShareUrl}
                className="shrink-0 rounded-md bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-400"
              >
                {shareCopied ? "Đã sao chép" : "Sao chép"}
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShareMeeting(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:border-slate-500"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
      {renameMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101624] p-6 shadow-2xl shadow-black/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-meeting-title"
          >
            <h2
              id="rename-meeting-title"
              className="text-lg font-bold text-white"
            >
              Đổi tên tệp
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Phần mở rộng tệp được giữ nguyên để tránh làm hỏng file.
            </p>
            <div className="mt-5 flex items-center rounded-lg border border-slate-700 bg-[#171d31] focus-within:border-blue-500/60">
              <input
                autoFocus
                value={renameBaseName}
                onChange={(event) => setRenameBaseName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleRename()}
                className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-white outline-none"
                aria-label="Tên mới của tệp"
              />
              <span className="border-l border-slate-700 px-3 py-2.5 text-sm text-slate-500">
                {getExtension(
                  renameMeeting.fileName || renameMeeting.title || "",
                )}
              </span>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!isRenaming) {
                    setRenameMeeting(null);
                    setRenameError("");
                  }
                }}
                disabled={isRenaming}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={!renameBaseName.trim() || isRenaming}
                onClick={handleRename}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRenaming ? "Đang lưu..." : "Lưu tên"}
              </button>
            </div>
            {renameError && (
              <p className="mt-3 text-xs text-red-300" role="alert">
                {renameError}
              </p>
            )}
          </div>
        </div>
      )}


    </DashboardLayout>
  );
}
