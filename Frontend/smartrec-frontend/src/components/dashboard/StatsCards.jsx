import React from "react";

const cards = [
  {
    label: "Tổng số cuộc họp",
    color: "blue",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect
          x="2"
          y="4"
          width="18"
          height="14"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M8 2v4M14 2v4M2 9h18"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: "Thời gian đã xử lý",
    color: "amber",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M11 6v5.5l3.5 2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: "Tác vụ AI",
    color: "green",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M11 2L2 7v8l9 5 9-5V7l-9-5z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M2 7l9 5 9-5M11 12v10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const colorMap = {
  blue: {
    bg: "rgba(62,137,255,0.12)",
    border: "rgba(62,137,255,0.3)",
    text: "#3e89ff",
    badge: "rgba(62,137,255,0.18)",
  },
  amber: {
    bg: "rgba(255,183,46,0.12)",
    border: "rgba(255,183,46,0.3)",
    text: "#ffb72e",
    badge: "rgba(255,183,46,0.18)",
  },
  green: {
    bg: "rgba(24,201,154,0.12)",
    border: "rgba(24,201,154,0.3)",
    text: "#18c99a",
    badge: "rgba(24,201,154,0.18)",
  },
};

const formatHours = (meetings) => {
  const seconds = meetings.reduce(
    (total, meeting) => total + (Number(meeting.durationSeconds) || 0),
    0,
  );
  return `${(seconds / 3600).toFixed(1)}h`;
};

const StatsCards = ({
  meetings = [],
  totalMeetings = 0,
  isLoading = false,
}) => {
  const values = [
    isLoading ? "..." : totalMeetings.toString(),
    isLoading ? "..." : formatHours(meetings),
    "Chưa có API",
  ];

  return (
    <div className="stats-row">
      {cards.map((card, index) => {
        const c = colorMap[card.color];
        return (
          <div key={card.label} className="stat-card">
            <div
              className="stat-icon"
              style={{
                background: c.bg,
                border: `1px solid ${c.border}`,
                color: c.text,
              }}
            >
              {card.icon}
            </div>
            <div className="stat-body">
              <span className="stat-label">{card.label}</span>
              <div className="stat-value-row">
                <span className="stat-value">{values[index]}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StatsCards;
