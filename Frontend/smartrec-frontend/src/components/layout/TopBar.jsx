import React from 'react';

const TopBar = ({ hideSearch = false }) => {
  const displayName = 'Alex Nguyen';

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
        <div className="topbar-avatar">
          <div className="avatar-circle">{initials}</div>
          <div className="avatar-info">
            <span className="avatar-name">{displayName}</span>
            <span className="avatar-role">Pro Plan</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
