import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDateInput,
  getDateInputLimits,
  getMeetingDateRange,
  matchesMeetingDateRange,
} from "./meetingDateFilter.js";

const now = new Date(2026, 10, 11, 14, 30);

test("last 30 days includes the current day and the 29 previous days", () => {
  const range = getMeetingDateRange({ filter: "last30", now });
  assert.equal(formatDateInput(range.start), "2026-10-13");
  assert.equal(formatDateInput(range.endExclusive), "2026-11-12");
  assert.equal(
    matchesMeetingDateRange(
      { createdAt: new Date(2026, 10, 11, 23, 59).toISOString() },
      range,
    ),
    true,
  );
  assert.equal(
    matchesMeetingDateRange(
      { createdAt: new Date(2026, 9, 12, 23, 59).toISOString() },
      range,
    ),
    false,
  );
});

test("today, last 7 days and all time use inclusive local calendar days", () => {
  const today = getMeetingDateRange({ filter: "today", now });
  const last7 = getMeetingDateRange({ filter: "last7", now });
  const all = getMeetingDateRange({ filter: "all", now });
  assert.equal(formatDateInput(today.start), "2026-11-11");
  assert.equal(formatDateInput(last7.start), "2026-11-05");
  assert.equal(
    matchesMeetingDateRange(
      { createdAt: new Date(2026, 10, 5, 0, 0).toISOString() },
      last7,
    ),
    true,
  );
  assert.equal(matchesMeetingDateRange({}, all), true);
  assert.equal(
    matchesMeetingDateRange(
      { createdAt: new Date(2026, 10, 10, 23, 59, 59).toISOString() },
      today,
    ),
    false,
  );
});

test("custom range is inclusive through the end of its final day", () => {
  const range = getMeetingDateRange({
    filter: "custom",
    startDate: "2026-11-08",
    endDate: "2026-11-10",
    now,
  });
  assert.equal(range.error, "");
  assert.equal(
    matchesMeetingDateRange(
      { createdAt: new Date(2026, 10, 10, 23, 59, 59).toISOString() },
      range,
    ),
    true,
  );
  assert.equal(
    matchesMeetingDateRange(
      { createdAt: new Date(2026, 10, 11, 0, 0).toISOString() },
      range,
    ),
    false,
  );
});

test("custom range reports missing, reversed, out-of-range and future dates", () => {
  const missing = getMeetingDateRange({ filter: "custom", now });
  assert.match(missing.error, /chọn ngày bắt đầu/);

  const reversed = getMeetingDateRange({
    filter: "custom",
    startDate: "2026-11-10",
    endDate: "2026-11-09",
    now,
  });
  assert.match(reversed.error, /Ngày bắt đầu phải/);

  const tooOld = getMeetingDateRange({
    filter: "custom",
    startDate: "2026-10-12",
    endDate: "2026-10-13",
    now,
  });
  assert.match(tooOld.error, /30 ngày gần nhất/);

  const future = getMeetingDateRange({
    filter: "custom",
    startDate: "2026-11-11",
    endDate: "2026-11-12",
    now,
  });
  assert.match(future.error, /30 ngày gần nhất/);
});

test("date picker limits use the current local day", () => {
  assert.deepEqual(getDateInputLimits(now), {
    min: "2026-10-13",
    max: "2026-11-11",
  });
});
