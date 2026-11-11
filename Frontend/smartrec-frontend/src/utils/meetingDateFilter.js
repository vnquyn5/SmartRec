const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const parseDateInput = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

export const formatDateInput = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const getDateInputLimits = (now = new Date()) => {
  const today = startOfDay(now);
  const oldest = new Date(today);
  oldest.setDate(oldest.getDate() - 29);
  return { min: formatDateInput(oldest), max: formatDateInput(today) };
};

export const getMeetingDateRange = ({
  filter = "last30",
  startDate = "",
  endDate = "",
  now = new Date(),
} = {}) => {
  const today = startOfDay(now);
  const endExclusive = new Date(today);
  endExclusive.setDate(endExclusive.getDate() + 1);

  if (filter === "all") return { start: null, endExclusive: null, error: "" };

  if (filter === "today" || filter === "last7" || filter === "last30") {
    const start = new Date(today);
    start.setDate(start.getDate() - (filter === "today" ? 0 : filter === "last7" ? 6 : 29));
    return { start, endExclusive, error: "" };
  }

  if (filter !== "custom") {
    return { start: null, endExclusive: null, error: "Khoảng ngày không hợp lệ." };
  }

  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  if (!start || !end) {
    return {
      start: null,
      endExclusive: null,
      error: "Vui lòng chọn ngày bắt đầu và ngày kết thúc.",
    };
  }
  if (start > end) {
    return {
      start: null,
      endExclusive: null,
      error: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.",
    };
  }
  const oldest = new Date(today);
  oldest.setDate(oldest.getDate() - 29);
  if (start < oldest || end > today) {
    return {
      start: null,
      endExclusive: null,
      error: "Khoảng ngày phải nằm trong 30 ngày gần nhất và không vượt quá hôm nay.",
    };
  }

  const nextDay = new Date(end);
  nextDay.setDate(nextDay.getDate() + 1);
  return { start, endExclusive: nextDay, error: "" };
};

export const matchesMeetingDateRange = (meeting, range) => {
  if (range.error) return false;
  if (!range.start && !range.endExclusive) return true;
  if (!meeting?.createdAt) return false;
  const timestamp = new Date(meeting.createdAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= range.start.getTime() && timestamp < range.endExclusive.getTime();
};

