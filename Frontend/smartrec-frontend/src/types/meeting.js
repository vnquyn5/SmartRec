/** @typedef {'UNPROCESSED'|'PENDING'|'PROCESSING'|'COMPLETED'|'FAILED'} MeetingStatus */

export const MEETING_STATUS = Object.freeze({
  UNPROCESSED: "UNPROCESSED",
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
});

/** @type {Record<MeetingStatus, {label: string, badgeClass: string, dotClass: string}>} */
export const MEETING_STATUS_CONFIG = Object.freeze({
  UNPROCESSED: {
    label: "Chưa xử lý",
    badgeClass:
      "bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
  PENDING: {
    label: "Đang xử lý AI",
    badgeClass:
      "bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
  PROCESSING: {
    label: "Đang xử lý",
    badgeClass:
      "bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/25",
    dotClass: "bg-blue-400",
  },
  COMPLETED: {
    label: "Hoàn tất",
    badgeClass:
      "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/25",
    dotClass: "bg-emerald-400",
  },
  FAILED: {
    label: "Lỗi",
    badgeClass: "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/25",
    dotClass: "bg-red-400",
  },
});
