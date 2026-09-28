import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthProvider';

const TopBar = ({ hideSearch = false, title, showBack, onBack, searchQuery, onSearchChange }) => {
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
      <div className="topbar-left" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {showBack && (
          <button onClick={onBack} className="btn-icon" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {title && <h1 className="topbar-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{title}</h1>}
      </div>
      {!hideSearch ? (
        <div className="topbar-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input 
            type="text" 
            placeholder="Search for meetings, transcripts..." 
            value={searchQuery || ''} 
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)} 
          />
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
