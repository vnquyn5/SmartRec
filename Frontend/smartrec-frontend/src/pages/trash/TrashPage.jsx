import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertIcon,
  MoreIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from "../../components/common/icons.jsx";

const TRASH_ITEMS = [
  {
    id: "trash-1",
    name: "meeting-notes-2023.mp4",
    status: "Đã xử lý",
    size: "85.2 MB",
    deletedAt: "24/03/2024",
    remaining: "25 ngày",
    type: "file",
  },
  {
    id: "trash-2",
    name: "unprocessed-call.mp3",
    status: "Chưa xử lý",
    size: "12.4 MB",
    deletedAt: "22/03/2024",
    remaining: "23 ngày",
    type: "file",
  },
  {
    id: "trash-3",
    name: "old-recordings-folder",
    status: "Thư mục",
    size: "--",
    deletedAt: "20/03/2024",
    remaining: "21 ngày",
    type: "folder",
  },
];

const tabs = ["Tất cả", "Đã xử lý", "Chưa xử lý"];

const getStatusClasses = (status) => {
  if (status === "Đã xử lý") {
    return "border-blue-400/20 bg-blue-500/10 text-blue-300";
  }
  if (status === "Chưa xử lý") {
    return "border-slate-500/20 bg-slate-500/15 text-slate-300";
  }
  return "border-slate-600/30 bg-slate-700/35 text-slate-300";
};

const FileIcon = ({ type, status }) => {
  if (type === "folder") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/60 text-slate-300">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
        </svg>
      </span>
    );
  }

  if (status === "Chưa xử lý") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-300">
        <AlertIcon className="h-4 w-4" />
      </span>
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-300">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h6.8L19 6.7v13.8a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20.5v-17Zm8 0V7h3.5L14 3.5ZM9 12h6v1.5H9V12Zm0 3h6v1.5H9V15Z" />
      </svg>
    </span>
  );
};

export default function TrashPage() {
  const [items, setItems] = useState(TRASH_ITEMS);
  const [activeTab, setActiveTab] = useState("Tất cả");
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [message, setMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const selectAllRef = useRef(null);
  const menuRef = useRef(null);

  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return items.filter((item) => {
      const matchesTab = activeTab === "Tất cả" || item.status === activeTab;
      const matchesKeyword =
        !normalizedKeyword || item.name.toLowerCase().includes(normalizedKeyword);
      return matchesTab && matchesKeyword;
    });
  }, [activeTab, items, keyword]);

  const visibleIds = filteredItems.map((item) => item.id);
  const selectedVisibleCount = visibleIds.filter((id) =>
    selectedIds.has(id),
  ).length;
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = selectedVisibleCount > 0;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const itemIds = new Set(items.map((item) => item.id));
    setSelectedIds((currentIds) => {
      const nextIds = new Set(
        Array.from(currentIds).filter((id) => itemIds.has(id)),
      );
      return nextIds.size === currentIds.size ? currentIds : nextIds;
    });
  }, [items]);

  const toggleAllVisible = () => {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => nextIds.delete(id));
      } else {
        visibleIds.forEach((id) => nextIds.add(id));
      }
      return nextIds;
    });
  };

  const toggleItem = (itemId) => {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(itemId)) nextIds.delete(itemId);
      else nextIds.add(itemId);
      return nextIds;
    });
  };

  const removeItems = (ids, action) => {
    const idSet = new Set(ids);
    const removedCount = items.filter((item) => idSet.has(item.id)).length;

    setItems((currentItems) =>
      currentItems.filter((item) => !idSet.has(item.id)),
    );
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      ids.forEach((id) => nextIds.delete(id));
      return nextIds;
    });
    setMessage(
      `${action} ${removedCount} tệp. Đây là tương tác UI mock, chưa gọi API.`,
    );
  };

  const restoreSelected = () => {
    removeItems(Array.from(selectedIds), "Đã khôi phục");
  };

  const restoreAll = () => {
    setMenuOpen(false);
    setConfirmState({
      type: "restore",
      title: "Khôi phục tất cả tệp?",
      message:
        "Bạn có chắc muốn khôi phục tất cả file trong thùng rác? Các file này sẽ được đưa ra khỏi danh sách Trash.",
      confirmLabel: "Khôi phục tất cả",
      ids: items.map((item) => item.id),
    });
  };

  const requestDeleteSelected = () => {
    setConfirmState({
      type: "delete",
      title: "Xóa vĩnh viễn tệp đã chọn?",
      message: `Bạn có chắc muốn xóa vĩnh viễn ${selectedIds.size} file đã chọn? Hành động này không thể hoàn tác.`,
      confirmLabel: "Xóa",
      ids: Array.from(selectedIds),
    });
  };

  const requestDeleteAll = () => {
    setMenuOpen(false);
    setConfirmState({
      type: "delete-all",
      step: 1,
      title: "Xóa tất cả tệp?",
      message:
        "Bạn có chắc muốn xóa vĩnh viễn tất cả file trong thùng rác? Hành động này không thể hoàn tác.",
      confirmLabel: "Tiếp tục",
      ids: items.map((item) => item.id),
    });
  };

  const requestDeleteOne = (item) => {
    setConfirmState({
      type: "delete",
      title: "Xóa vĩnh viễn tệp?",
      message: `Bạn có chắc muốn xóa vĩnh viễn "${item.name}"? Hành động này không thể hoàn tác.`,
      confirmLabel: "Xóa",
      ids: [item.id],
    });
  };

  const confirmAction = () => {
    if (!confirmState) return;

    if (confirmState.type === "restore") {
      removeItems(confirmState.ids, "Đã khôi phục");
      setConfirmState(null);
      return;
    }

    if (confirmState.type === "delete-all" && confirmState.step === 1) {
      setConfirmState((currentState) => ({
        ...currentState,
        step: 2,
        title: "Xác nhận lần cuối",
        message:
          "Toàn bộ file trong thùng rác sẽ bị xóa vĩnh viễn và không thể hoàn tác. Bạn chắc chắn muốn tiếp tục?",
        confirmLabel: "Xóa vĩnh viễn",
      }));
      return;
    }

    removeItems(confirmState.ids, "Đã xóa vĩnh viễn");
    setConfirmState(null);
  };

  const handleMockAction = (action, target = "các tệp") => {
    setMessage(`${action} ${target}. Đây là tương tác UI mock, chưa gọi API.`);
  };

  return (
    <div className="mx-auto max-w-[1180px] space-y-5">
      <header className="space-y-4">
        <div>
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-white">
            Thùng rác
          </h1>
          <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/10 px-4 py-3 text-sm text-slate-400">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-400 text-[10px] font-bold text-slate-950">
              i
            </span>
            <span>
              Các tệp trong thùng rác sẽ tự động bị xóa vĩnh viễn sau 30 ngày.
            </span>
          </div>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex flex-col gap-4 border-b border-white/5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-7 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`relative whitespace-nowrap px-0 pb-4 text-sm font-semibold transition ${
                  activeTab === tab
                    ? "text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab}
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-blue-500" />
                )}
              </button>
            ))}
          </div>

          <div className="mb-3 hidden md:block" />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[#101624] p-4 shadow-xl shadow-black/10 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-[320px]">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Tìm kiếm file trong thùng rác..."
              className="w-full rounded-lg border border-slate-800 bg-[#171d31] py-2.5 pl-9 pr-3 text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedIds.size > 0 && (
              <>
                <span className="mr-1 text-xs font-medium text-slate-400">
                  Đã chọn {selectedIds.size} tệp
                </span>
                <button
                  type="button"
                  onClick={restoreSelected}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 transition hover:bg-blue-500/20 hover:text-white"
                >
                  <RefreshIcon className="h-3.5 w-3.5" />
                  Khôi phục
                </button>
                <button
                  type="button"
                  onClick={requestDeleteSelected}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 hover:text-white"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Xóa
                </button>
              </>
            )}

            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((isOpen) => !isOpen)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-[#171d31] text-slate-400 transition hover:border-blue-500/50 hover:text-white"
                aria-label="Mở menu tác vụ thùng rác"
                aria-expanded={menuOpen}
              >
                <MoreIcon className="h-4 w-4" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-11 z-20 w-48 overflow-hidden rounded-lg border border-white/10 bg-[#12182a] py-1 shadow-2xl shadow-black/40">
                  <button
                    type="button"
                    onClick={restoreAll}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-slate-200 transition hover:bg-blue-500/10 hover:text-blue-200"
                  >
                    <RefreshIcon className="h-3.5 w-3.5" />
                    Khôi phục tất cả
                  </button>
                  <button
                    type="button"
                    onClick={requestDeleteAll}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Xóa tất cả
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {message && (
          <div className="flex items-center justify-between rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
            <span>{message}</span>
            <button
              type="button"
              onClick={() => setMessage("")}
              className="ml-3 text-blue-300 hover:text-white"
              aria-label="Đóng thông báo"
            >
              ×
            </button>
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-white/5 bg-[#101624] shadow-xl shadow-black/10">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-white/5 bg-white/[0.015] text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-12 px-5 py-4">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Chọn tất cả tệp trong thùng rác"
                      className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 accent-blue-500"
                    />
                  </th>
                  <th className="px-4 py-4 font-bold">Tên file</th>
                  <th className="px-4 py-4 font-bold">Trạng thái</th>
                  <th className="px-4 py-4 font-bold">Kích thước</th>
                  <th className="px-4 py-4 font-bold">Ngày xóa</th>
                  <th className="px-4 py-4 font-bold">Còn lại</th>
                  <th className="px-4 py-4 text-right font-bold">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className="transition hover:bg-blue-500/[0.03]"
                  >
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleItem(item.id)}
                        aria-label={`Chọn ${item.name}`}
                        className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 accent-blue-500"
                      />
                    </td>
                    <td className="px-4 py-4 font-medium text-slate-100">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileIcon type={item.type} status={item.status} />
                        <span className="truncate">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${getStatusClasses(item.status)}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-500">
                      {item.size}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-500">
                      {item.deletedAt}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-500">
                      {item.remaining}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          title="Khôi phục"
                          onClick={() => removeItems([item.id], "Đã khôi phục")}
                          className="rounded p-1.5 text-slate-500 transition hover:bg-blue-500/10 hover:text-blue-300"
                        >
                          <RefreshIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Xóa vĩnh viễn"
                          onClick={() => requestDeleteOne(item)}
                          className="rounded p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredItems.length === 0 && (
                  <tr>
                    <td
                      colSpan="7"
                      className="px-5 py-16 text-center text-sm text-slate-500"
                    >
                      Không tìm thấy file trong thùng rác.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-white/5 px-5 py-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị 1-3 trong tổng 12 tệp đã xóa</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled
                className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Trước
              </button>
              <button
                type="button"
                onClick={() => handleMockAction("Chuyển sang trang sau cho", "thùng rác")}
                className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Sau
              </button>
            </div>
          </div>
        </section>
      </section>
      {confirmState && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setConfirmState(null)
          }
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101624] p-6 shadow-2xl shadow-black/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trash-confirm-title"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300">
                {confirmState.type === "restore" ? (
                  <RefreshIcon className="h-5 w-5" />
                ) : (
                  <TrashIcon className="h-5 w-5" />
                )}
              </span>
              <div>
                <h2
                  id="trash-confirm-title"
                  className="text-base font-bold text-white"
                >
                  {confirmState.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {confirmState.message}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={confirmAction}
                className={`rounded-lg border px-4 py-2 text-xs font-semibold transition hover:text-white ${
                  confirmState.type === "restore"
                    ? "border-blue-500/20 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
                    : "border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                }`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
