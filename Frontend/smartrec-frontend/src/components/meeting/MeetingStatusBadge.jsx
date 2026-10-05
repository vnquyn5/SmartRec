import { MEETING_STATUS_CONFIG } from "../../types/meeting.js";

export default function MeetingStatusBadge({ status }) {
  const config = MEETING_STATUS_CONFIG[status] ?? MEETING_STATUS_CONFIG.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${config.badgeClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </span>
  );
}
