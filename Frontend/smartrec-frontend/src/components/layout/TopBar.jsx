import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthProvider';

const TopBar = ({ hideSearch = false }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const displayName = user?.name || 'Đang tải...';
  const role = user?.role || '';

  const initials = displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="topbar">
      {!hideSearch ? (
        <div className="topbar-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input type="text" placeholder="Search for meetings, transcripts..." />
        </div>
      ) : (
        <div style={{ flex: 1 }}></div>
      )}

      <div className="topbar-right">
        <div
          className="topbar-avatar"
          onClick={() => navigate('/profile')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              navigate('/profile');
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Mở thông tin cá nhân"
        >
          <div className="avatar-circle">{initials}</div>
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
