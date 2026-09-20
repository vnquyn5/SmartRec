import { useEffect } from "react";
import { AlertIcon, SpinnerIcon } from "../common/icons.jsx";

export default function DeleteMeetingModal({
  open,
  title,
  loading,
  onClose,
  onConfirm,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !loading && onClose()
      }
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl shadow-black/40"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-meeting-title"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-400">
          <AlertIcon className="h-8 w-8" />
        </div>
        <h2 id="delete-meeting-title" className="text-lg font-bold text-white">
          Bạn có chắc muốn xóa file này không?
        </h2>
        <p className="mt-2 break-words text-sm text-slate-400">
          {title || "File cuộc họp"} sẽ bị xóa khỏi kho lưu trữ và không thể
          hoàn tác.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Hủy Bỏ
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <SpinnerIcon />}
            {loading ? "Đang xóa..." : "Đồng Ý Xóa"}
          </button>
        </div>
      </div>
    </div>
  );
}
