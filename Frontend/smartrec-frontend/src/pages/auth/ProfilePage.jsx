import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/* ── Icons ── */
const icons = {
  profile: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 16c0-3.04 2.91-5.5 6.5-5.5s6.5 2.46 6.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  roles: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 2L3 5v4c0 3.87 2.55 7.47 6 8.5 3.45-1.03 6-4.63 6-8.5V5L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 9.5l2 2 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  workspace: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 7h14" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4.5" cy="5" r="0.75" fill="currentColor" />
      <circle cx="7" cy="5" r="0.75" fill="currentColor" />
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M8.5 2.5l3 3M2 9.5L9.5 2l3 3L5 12.5H2v-3z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  home: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 8l6-5.5L14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 9v4.5a1 1 0 001 1h7a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="8" fill="rgba(24,201,154,0.15)" stroke="var(--sr-success)" strokeWidth="1.2" />
      <path d="M5.5 9.2l2.2 2.2 4.8-4.8" stroke="var(--sr-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  cross: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="8" fill="rgba(255,77,93,0.12)" stroke="var(--sr-error)" strokeWidth="1.2" />
      <path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="var(--sr-error)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8.5" stroke="var(--sr-blue)" strokeWidth="1.5" />
      <path d="M10 9v4M10 7h.01" stroke="var(--sr-blue)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  bulb: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1c-2.76 0-5 2.24-5 5 0 1.83 1.02 3.42 2.5 4.29V12c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-1.71c1.48-.87 2.5-2.46 2.5-4.29 0-2.76-2.24-5-5-5z" />
      <path d="M6 14h4v1H6z" />
    </svg>
  ),
  lock: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4.5 7V5c0-1.93 1.57-3.5 3.5-3.5s3.5 1.57 3.5 3.5v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="2.5" y="7" width="11" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="10.5" r="1.5" fill="currentColor" />
    </svg>
  ),
  pen: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M8.5 2.5l3 3M2 9.5L9.5 2l3 3L5 12.5H2v-3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3.5 5.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/* ── Settings sidebar tabs ── */
const settingsTabs = [
  { key: 'profile', label: 'Hồ sơ cá nhân', icon: 'profile' },
  { key: 'roles', label: 'Vai trò & Phân quyền', icon: 'roles' },
  { key: 'workspace', label: 'Quản lý Workspace', icon: 'workspace' },
];

/* ── Mock user data ── */
const initialUserData = {
  name: 'Minh Nguyen',
  email: 'minh.nguyen@example.com',
  phone: '+84 901 234 567',
  department: 'Engineering',
  joinDate: '12/05/2023',
  status: 'Đang hoạt động',
  role: 'WORKSPACE OWNER',
  avatar: null,
};

/* ── Permissions table data ── */
const rolesData = [
  {
    name: 'Quản trị viên (Admin)',
    description: 'Toàn quyền hệ thống',
    permissions: [true, true, true, true],
  },
  {
    name: 'Thành viên (Member)',
    description: 'Quyền hạn thông thường',
    permissions: [true, false, false, true],
  },
  {
    name: 'Người xem (Viewer)',
    description: 'Chỉ xem dữ liệu',
    permissions: [false, false, false, true],
  },
];

const permissionHeaders = ['TẠO CUỘC HỌP', 'XÓA CUỘC HỌP', 'QUẢN LÝ WORKSPACE', 'XEM BÁO CÁO'];

const ProfilePage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const [user, setUser] = useState(initialUserData);
  const [editForm, setEditForm] = useState({
    name: initialUserData.name,
    phone: initialUserData.phone,
    department: initialUserData.department,
    avatar: initialUserData.avatar,
  });
  const [errors, setErrors] = useState({});

  const handleEditClick = () => {
    setEditForm({ 
      name: user.name, 
      phone: user.phone, 
      department: user.department,
      avatar: user.avatar 
    });
    setErrors({});
    setIsEditing(true);
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setToastMessage('Ảnh tải lên vượt quá dung lượng 5MB');
        setTimeout(() => setToastMessage(''), 3000);
        return;
      }
      const url = URL.createObjectURL(file);
      setEditForm({ ...editForm, avatar: url });
    }
  };

  const validateForm = () => {
    const newErrors = {};
    const nameVal = editForm.name.trim();
    const phoneVal = editForm.phone.trim();

    // Regex check for numbers or special chars (allowing letters, spaces, and basic punctuation like hyphen)
    const hasNumber = /\d/.test(nameVal);
    const hasSpecialChar = /[!@#$%^&*()_+=\[\]{};':"\\|,.<>/?]/.test(nameVal);

    // Validate Name
    const words = nameVal.split(' ').filter(w => w.length > 0);
    if (!nameVal) {
      newErrors.name = 'Họ và tên không được để trống';
    } else if (words.length < 2) {
      newErrors.name = 'Vui lòng nhập đầy đủ cả họ và tên (ví dụ: Nguyễn Văn A)';
    } else if (nameVal.length > 50) {
      newErrors.name = 'Họ và tên quá dài, vui lòng nhập chính xác tên thật của bạn';
    } else if (hasNumber || hasSpecialChar) {
      newErrors.name = 'Họ và tên chỉ được chứa chữ cái, không chứa số hay ký hiệu';
    }
    
    // Validate Phone (Vietnamese format)
    const cleanPhone = phoneVal.replace(/[\s-]/g, '');
    const vnPhoneRegex = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/;

    if (!phoneVal) {
      newErrors.phone = 'Số điện thoại không được để trống';
    } else if (/[a-zA-Z]/.test(phoneVal)) {
      newErrors.phone = 'Số điện thoại không hợp lệ (không chứa chữ cái)';
    } else if (!vnPhoneRegex.test(cleanPhone)) {
      newErrors.phone = 'Định dạng số điện thoại không hợp lệ (VD: 0912345678 hoặc +84912345678)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validateForm()) return;

    setUser((prev) => ({
      ...prev,
      name: editForm.name,
      phone: editForm.phone,
      department: editForm.department,
      avatar: editForm.avatar,
    }));

    setToastMessage('Đã lưu thay đổi thành công!');
    setIsEditing(false);
    
    setTimeout(() => {
      setToastMessage('');
    }, 3000);
  };

  return (
    <div className="dashboard-shell">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="profile-toast">
          {icons.check}
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── Settings Sidebar ── */}
      <aside className="profile-sidebar">
        <div className="profile-sidebar-top">
          {/* Brand */}
          <div className="sidebar-brand">
            <div className="auth-logo-mark"><span /></div>
            <strong>Smart<span>Rec</span></strong>
          </div>

          {/* Settings section label */}
          <div className="profile-sidebar-label">CÀI ĐẶT</div>

          {/* Tabs */}
          <nav className="profile-sidebar-nav">
            {settingsTabs.map((tab) => (
              <button
                key={tab.key}
                className={`profile-sidebar-link${activeTab === tab.key ? ' is-active' : ''}`}
                onClick={() => {
                  setActiveTab(tab.key);
                  setIsEditing(false);
                }}
              >
                {icons[tab.icon]}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="dashboard-main">
        {/* Top bar */}
        <header className="topbar">
          <div style={{ flex: 1 }} />
          <div className="topbar-right">
            <button className="profile-home-btn" onClick={() => navigate('/')}>
              {icons.home}
              <span>Về trang chủ</span>
            </button>
            <div className="topbar-avatar">
              {user.avatar ? (
                <img src={user.avatar} alt="Avatar" className="avatar-circle" style={{ padding: 0, objectFit: 'cover' }} />
              ) : (
                <div className="avatar-circle">
                  {user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="avatar-info">
                <span className="avatar-name">{user.name}</span>
                <span className="avatar-role">Workspace Owner</span>
              </div>
            </div>
          </div>
        </header>

        <div className="dashboard-content">
          {/* ══════════════ TAB: Hồ sơ cá nhân (Chế độ Edit) ══════════════ */}
          {activeTab === 'profile' && isEditing && (
             <div className="profile-edit-section">
                <div className="profile-edit-header">
                  <h1>Chỉnh sửa hồ sơ</h1>
                  <div className="profile-edit-actions">
                    <button className="btn-cancel" onClick={() => setIsEditing(false)}>Hủy bỏ</button>
                    <button className="btn-save" onClick={handleSave}>Lưu thay đổi</button>
                  </div>
                </div>

                <div className="profile-edit-form-wrap">
                  {/* Avatar section */}
                  <div className="profile-edit-avatar-box">
                    <div className="profile-avatar-ring large">
                      {editForm.avatar ? (
                        <img src={editForm.avatar} alt="Avatar Preview" className="profile-avatar-img" />
                      ) : (
                        <div className="profile-avatar-placeholder">
                          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                            <circle cx="24" cy="18" r="9" stroke="currentColor" strokeWidth="2" />
                            <path d="M6 44c0-9.94 8.06-18 18-18s18 8.06 18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </div>
                      )}
                      <input 
                        type="file" 
                        id="avatar-upload" 
                        accept="image/png, image/jpeg" 
                        style={{ display: 'none' }} 
                        onChange={handleAvatarChange} 
                      />
                      <button 
                        className="avatar-edit-btn" 
                        title="Đổi ảnh đại diện"
                        onClick={() => document.getElementById('avatar-upload').click()}
                      >
                        {icons.pen}
                      </button>
                    </div>
                    <span className="avatar-upload-hint">Tải lên ảnh PNG hoặc JPG (Tối đa 5MB)</span>
                  </div>

                  {/* Form fields */}
                  <div className="profile-form-grid">
                    <div className="form-group">
                      <label>HỌ VÀ TÊN</label>
                      <input 
                        type="text" 
                        value={editForm.name}
                        onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                        className={`profile-input ${errors.name ? 'input-error' : ''}`} 
                      />
                      {errors.name && <span className="error-text">{errors.name}</span>}
                    </div>
                    
                    <div className="form-group">
                      <label>EMAIL</label>
                      <div className="input-with-icon">
                        <input type="email" value={user.email} className="profile-input" disabled />
                        <span className="input-icon">{icons.lock}</span>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>SỐ ĐIỆN THOẠI</label>
                      <input 
                        type="text" 
                        value={editForm.phone}
                        onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                        className={`profile-input ${errors.phone ? 'input-error' : ''}`} 
                      />
                      {errors.phone && <span className="error-text">{errors.phone}</span>}
                    </div>

                    <div className="form-group">
                      <label>PHÒNG BAN</label>
                      <div className="select-wrapper">
                        <select 
                          value={editForm.department}
                          onChange={(e) => setEditForm({...editForm, department: e.target.value})}
                          className="profile-input"
                        >
                          <option value="Engineering">Engineering</option>
                          <option value="Design">Design</option>
                          <option value="Marketing">Marketing</option>
                          <option value="HR">Human Resources</option>
                        </select>
                        <span className="select-icon">{icons.chevronDown}</span>
                      </div>
                    </div>
                  </div>

                  {/* Notices */}
                  <div className="profile-notice-box security-notice">
                    <div className="notice-icon">{icons.bulb}</div>
                    <div className="notice-text">
                      <strong>Lưu ý bảo mật</strong>
                      <p>Email không thể thay đổi sau khi tạo tài khoản. Nếu bạn cần cập nhật email, vui lòng liên hệ với bộ phận Quản trị viên hệ thống.</p>
                    </div>
                  </div>
                  
                  <div className="profile-notice-box tip-notice">
                    <div className="notice-icon">{icons.bulb}</div>
                    <div className="notice-text">
                      <strong>Mẹo nhỏ</strong>
                      <p>Bạn có thể tùy chỉnh từng quyền hạn cụ thể cho thành viên trong phần Quản lý Workspace. Đừng quên lưu lại thay đổi sau khi cập nhật nhé!</p>
                    </div>
                  </div>
                </div>
             </div>
          )}

          {/* ══════════════ TAB: Hồ sơ cá nhân (Chế độ Xem) ══════════════ */}
          {activeTab === 'profile' && !isEditing && (
            <div className="profile-section">
              <div className="profile-section-header">
                <h1>Thông tin cá nhân</h1>
                <button className="profile-edit-btn" onClick={handleEditClick}>
                  {icons.edit}
                  <span>Chỉnh sửa</span>
                </button>
              </div>

              <div className="profile-info-card">
                <div className="profile-avatar-col">
                  <div className="profile-avatar-ring">
                    {user.avatar ? (
                      <img src={user.avatar} alt="Avatar" className="profile-avatar-img" />
                    ) : (
                      <div className="profile-avatar-placeholder">
                        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                          <circle cx="24" cy="18" r="9" stroke="currentColor" strokeWidth="2" />
                          <path d="M6 44c0-9.94 8.06-18 18-18s18 8.06 18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <h3 className="profile-avatar-name">{user.name}</h3>
                  <span className="profile-avatar-email">{user.email}</span>
                  <span className="profile-role-badge">{user.role}</span>
                </div>

                <div className="profile-details-grid">
                  <div className="profile-detail-item">
                    <span className="profile-detail-label">HỌ VÀ TÊN</span>
                    <span className="profile-detail-value">{user.name}</span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="profile-detail-label">EMAIL</span>
                    <span className="profile-detail-value">{user.email}</span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="profile-detail-label">SỐ ĐIỆN THOẠI</span>
                    <span className="profile-detail-value">{user.phone}</span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="profile-detail-label">PHÒNG BAN</span>
                    <span className="profile-detail-value">{user.department}</span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="profile-detail-label">NGÀY THAM GIA</span>
                    <span className="profile-detail-value">{user.joinDate}</span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="profile-detail-label">TRẠNG THÁI</span>
                    <span className="profile-detail-value profile-status">
                      <span className="status-dot" />
                      {user.status}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════ TAB: Vai trò & Phân quyền ══════════════ */}
          {(activeTab === 'roles') && (
            <div className="profile-section">
              <div className="profile-section-header">
                <div>
                  <h1>Quản lý vai trò</h1>
                  <p className="profile-section-desc">
                    Xác định các mức độ truy cập và quyền hạn cho các thành viên trong Workspace.
                  </p>
                </div>
              </div>

              <div className="profile-roles-table-wrap">
                <table className="profile-roles-table">
                  <thead>
                    <tr>
                      <th className="roles-th-name">VAI TRÒ</th>
                      {permissionHeaders.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rolesData.map((role) => (
                      <tr key={role.name}>
                        <td className="roles-td-name">
                          <strong>{role.name}</strong>
                          <span>{role.description}</span>
                        </td>
                        {role.permissions.map((allowed, i) => (
                          <td key={i} className="roles-td-perm">
                            {allowed ? icons.check : icons.cross}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="profile-tip-box">
                <div className="profile-tip-icon">{icons.info}</div>
                <div className="profile-tip-content">
                  <strong>Mẹo nhỏ</strong>
                  <p>
                    Bạn có thể tùy chỉnh từng quyền hạn cụ thể cho thành viên trong phần Quản lý Workspace.
                    Đừng quên lưu lại thay đổi sau khi cập nhật nhé!
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
