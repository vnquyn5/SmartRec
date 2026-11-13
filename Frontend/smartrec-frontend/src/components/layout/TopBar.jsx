import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthProvider";
import { usePageHeader } from "./PageHeaderContext.jsx";
import { getPageHeader } from "./pageHeaderConfig.js";

const TopBar = ({ hideSearch = false }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { pageHeader } = usePageHeader();
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [user?.avatarUrl]);
  const displayName = user?.name || "Đang tải...";
  const role = user?.role || "";
  const routeHeader = getPageHeader(pathname);
  const header = pageHeader || routeHeader;

  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className={`topbar${hideSearch ? " topbar--page" : ""}`}>
      {!hideSearch ? (
        <div className="topbar-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle
              cx="7"
              cy="7"
              r="5.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M11 11l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            placeholder="Search for meetings, transcripts..."
          />
        </div>
      ) : null}

      <div className="topbar-page-title" aria-live="polite">
        {header.title && (
          <h1 title={header.title}>{header.title}</h1>
        )}
        {header.subtitle && (
          <p title={header.subtitle}>{header.subtitle}</p>
        )}
      </div>

      <div className="topbar-right">
        <div
          className="topbar-avatar"
          onClick={() => navigate("/profile")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              navigate("/profile");
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Mở thông tin cá nhân"
        >
          <div className="avatar-circle">
            {user?.avatarUrl && !avatarFailed ? (
              <img src={user.avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
            ) : initials}
          </div>
          <div className="avatar-info">
            <span className="avatar-name">{displayName}</span>
            <span className="avatar-role">{role}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
