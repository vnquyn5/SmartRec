export default function Pagination({
  currentPage,
  totalPages,
  totalElements,
  pageSize,
  onPageChange,
}) {
  if (totalPages <= 1) return null;
  const firstItem = totalElements === 0 ? 0 : currentPage * pageSize + 1;
  const lastItem = Math.min((currentPage + 1) * pageSize, totalElements);
  return (
    <div className="flex flex-col gap-3 border-t border-white/5 px-5 py-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Hiển thị {firstItem} - {lastItem} trên {totalElements} tệp
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-700 px-3 py-2 font-medium text-slate-300 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Trước
        </button>
        <span className="px-2 text-slate-500">
          {currentPage + 1} / {totalPages}
        </span>
        <button
          type="button"
          className="rounded-lg border border-slate-700 px-3 py-2 font-medium text-slate-300 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={currentPage >= totalPages - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Sau
        </button>
      </div>
    </div>
  );
}
