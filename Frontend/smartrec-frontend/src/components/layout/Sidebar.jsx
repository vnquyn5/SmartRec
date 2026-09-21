import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthProvider";

const navItems = [
  { to: "/", icon: "dashboard", label: "Tổng quan" },
  { to: "/history", icon: "history", label: "Danh sách cuộc họp" },
  { to: "/workspace", icon: "workspace", label: "Không gian cuộc họp" },
  { to: "/export", icon: "export", label: "Xuất dữ liệu" },
];

const icons = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="2" width="7" height="7" rx="2" fill="currentColor" />
      <rect
        x="11"
        y="2"
        width="7"
        height="7"
        rx="2"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="2"
        y="11"
        width="7"
        height="7"
        rx="2"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="11"
        y="11"
        width="7"
        height="7"
        rx="2"
        fill="currentColor"
        opacity="0.3"
      />
    </svg>
  ),
  history: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 6v4.5l3 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  workspace: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M3 7l7-4 7 4v6l-7 4-7-4V7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10 11V17M3 7l7 4 7-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  export: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M10 3v10M6 9l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 14v2a2 2 0 002 2h10a2 2 0 002-2v-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.66 4.34l-1.42 1.42M5.76 14.24l-1.42 1.42M15.66 15.66l-1.42-1.42M5.76 5.76L4.34 4.34"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  profile: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 17c0-3.31 2.69-6 6-6s6 2.69 6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  logout: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3M13 14l4-4-4-4M17 10H7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

const Sidebar = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = async () => {
    await logout(); // Xoá token, đặt status = unauthenticated
    navigate("/login"); // Chuyển về trang đăng nhập
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <div className="auth-logo-mark">
            <span />
          </div>
          <strong>
            Smart<span>Rec</span>
          </strong>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `sidebar-link${isActive ? " is-active" : ""}`
              }
            >
              {icons[item.icon]}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="sidebar-bottom">
        <button
          className="sidebar-link sidebar-settings"
          onClick={() => navigate("/profile")}
          type="button"
        >
          {icons.settings}
          <span>Cài đặt</span>
        </button>
        <button className="sidebar-link sidebar-logout" onClick={handleLogout}>
          {icons.logout}
          <span>Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
