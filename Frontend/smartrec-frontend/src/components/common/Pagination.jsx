import { getPaginationPages } from "../../utils/paginationPages.js";

export default function Pagination({
  currentPage,
  totalPages,
  totalElements,
  pageSize,
  onPageChange,
  itemLabel = "tệp",
  loading = false,
}) {
  const firstItem = totalElements === 0 ? 0 : currentPage * pageSize + 1;
  const lastItem = Math.min((currentPage + 1) * pageSize, totalElements);
  const pages = getPaginationPages(totalPages, currentPage);
  const disablePrevious = loading || totalPages === 0 || currentPage <= 0;
  const disableNext = loading || totalPages === 0 || currentPage >= totalPages - 1;

  return (
    <div className="flex flex-col gap-3 border-t border-white/5 px-5 py-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Hiển thị {firstItem}-{lastItem} trên {totalElements} {itemLabel}
      </span>
      <nav className="flex flex-wrap items-center gap-1" aria-label="Phân trang">
        <button
          type="button"
          className="rounded-lg border border-slate-700 px-2.5 py-2 font-medium text-slate-300 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Trang trước"
          disabled={disablePrevious}
          onClick={() => onPageChange(currentPage - 1)}
        >
          ‹
        </button>
        {pages.map((page) => typeof page === "number" ? (
          <button
            key={page}
            type="button"
            aria-label={`Trang ${page + 1}`}
            aria-current={page === currentPage ? "page" : undefined}
            disabled={loading || page === currentPage}
            onClick={() => onPageChange(page)}
            className={`min-w-8 rounded-lg border px-2.5 py-2 font-medium transition disabled:cursor-default ${page === currentPage
              ? "border-blue-500/40 bg-blue-500/15 text-blue-200"
              : "border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-40"
            }`}
          >
            {page + 1}
          </button>
        ) : (
          <span key={page} className="px-1.5 text-slate-600" aria-hidden="true">…</span>
        ))}
        <button
          type="button"
          className="rounded-lg border border-slate-700 px-2.5 py-2 font-medium text-slate-300 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Trang sau"
          disabled={disableNext}
          onClick={() => onPageChange(currentPage + 1)}
        >
          ›
        </button>
      </nav>
    </div>
  );
}
