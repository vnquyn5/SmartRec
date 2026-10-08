/** @typedef {'UNPROCESSED'|'PENDING'|'PROCESSING'|'PAUSE_REQUESTED'|'PAUSED'|'CANCEL_REQUESTED'|'CANCELLED'|'COMPLETED'|'FAILED'} MeetingStatus */

export const MEETING_STATUS = Object.freeze({
  UNPROCESSED: "UNPROCESSED",
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PAUSE_REQUESTED: "PAUSE_REQUESTED",
  PAUSED: "PAUSED",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCELLED: "CANCELLED",
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
  PAUSE_REQUESTED: {
    label: "Đang tạm dừng…",
    badgeClass: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/25",
    dotClass: "bg-amber-400",
  },
  PAUSED: {
    label: "Đã tạm dừng",
    badgeClass: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/25",
    dotClass: "bg-amber-400",
  },
  CANCEL_REQUESTED: {
    label: "Đang hủy…",
    badgeClass: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/25",
    dotClass: "bg-amber-400",
  },
  CANCELLED: {
    label: "Đã hủy",
    badgeClass: "bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
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
