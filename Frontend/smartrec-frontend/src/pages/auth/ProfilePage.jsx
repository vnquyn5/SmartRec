import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/axiosClient";
import {
  isPasswordValid,
  validateConfirmPassword,
  validateEmail,
  validateFullName,
  validatePassword,
  validatePhone,
} from "../../utils/validators";

/* ── Icons ── */
const icons = {
  profile: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.5 16c0-3.04 2.91-5.5 6.5-5.5s6.5 2.46 6.5 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  roles: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M9 2L3 5v4c0 3.87 2.55 7.47 6 8.5 3.45-1.03 6-4.63 6-8.5V5L9 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 9.5l2 2 3.5-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  workspace: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="2"
        y="3"
        width="14"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M2 7h14" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4.5" cy="5" r="0.75" fill="currentColor" />
      <circle cx="7" cy="5" r="0.75" fill="currentColor" />
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M8.5 2.5l3 3M2 9.5L9.5 2l3 3L5 12.5H2v-3z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  home: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 8l6-5.5L14 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 9v4.5a1 1 0 001 1h7a1 1 0 001-1V9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle
        cx="9"
        cy="9"
        r="8"
        fill="rgba(24,201,154,0.15)"
        stroke="var(--sr-success)"
        strokeWidth="1.2"
      />
      <path
        d="M5.5 9.2l2.2 2.2 4.8-4.8"
        stroke="var(--sr-success)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  cross: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle
        cx="9"
        cy="9"
        r="8"
        fill="rgba(255,77,93,0.12)"
        stroke="var(--sr-error)"
        strokeWidth="1.2"
      />
      <path
        d="M6.5 6.5l5 5M11.5 6.5l-5 5"
        stroke="var(--sr-error)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  info: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle
        cx="10"
        cy="10"
        r="8.5"
        stroke="var(--sr-blue)"
        strokeWidth="1.5"
      />
      <path
        d="M10 9v4M10 7h.01"
        stroke="var(--sr-blue)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
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
      <path
        d="M4.5 7V5c0-1.93 1.57-3.5 3.5-3.5s3.5 1.57 3.5 3.5v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="2.5"
        y="7"
        width="11"
        height="7.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="8" cy="10.5" r="1.5" fill="currentColor" />
    </svg>
  ),
  eye: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M1.5 8s2.25-4 6.5-4 6.5 4 6.5 4-2.25 4-6.5 4-6.5-4-6.5-4z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  eyeOff: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 2l12 12M6.7 6.7a1.8 1.8 0 002.6 2.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M4.2 4.7C2.45 5.8 1.5 8 1.5 8s2.25 4 6.5 4c1.1 0 2.05-.25 2.85-.65M11.8 11.3C13.55 10.2 14.5 8 14.5 8s-2.25-4-6.5-4c-.4 0-.8.03-1.15.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  pen: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M8.5 2.5l3 3M2 9.5L9.5 2l3 3L5 12.5H2v-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M3.5 5.5l3.5 3.5 3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

/* ── Settings sidebar tabs ── */
const settingsTabs = [
  { key: "profile", label: "Hồ sơ cá nhân", icon: "profile" },
  { key: "password", label: "Đổi mật khẩu", icon: "lock" },
  { key: "roles", label: "Vai trò & Phân quyền", icon: "roles" },
  { key: "workspace", label: "Quản lý Workspace", icon: "workspace" },
];

const initialUserData = {
  userCode: "",
  name: "",
  email: "",
  phone: "",
  department: "",
  position: "",
  joinDate: "",
  status: "Đang hoạt động",
  role: "",
  avatar: null,
};

const emptyUserData = { ...initialUserData };

function formatJoinDate(createdAt) {
  if (!createdAt) return "";

  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? createdAt
    : date.toLocaleDateString("vi-VN");
}

/* ── Permissions table data ── */
const rolesData = [
  {
    name: "Quản trị viên (Admin)",
    description: "Toàn quyền hệ thống",
    permissions: [true, true, true, true],
  },
  {
    name: "Thành viên (Member)",
    description: "Quyền hạn thông thường",
    permissions: [true, false, false, true],
  },
  {
    name: "Người xem (Viewer)",
    description: "Chỉ xem dữ liệu",
    permissions: [false, false, false, true],
  },
];

const permissionHeaders = [
  "TẠO CUỘC HỌP",
  "XÓA CUỘC HỌP",
  "QUẢN LÝ WORKSPACE",
  "XEM BÁO CÁO",
];

const ProfilePage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("profile");
  const [isEditing, setIsEditing] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({
    oldPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [showPasswordSuccess, setShowPasswordSuccess] = useState(false);

  const [user, setUser] = useState(null);
  const [editForm, setEditForm] = useState({
    userCode: initialUserData.userCode,
    name: initialUserData.name,
    email: initialUserData.email,
    phone: initialUserData.phone,
    department: initialUserData.department,
    position: initialUserData.position,
    avatar: initialUserData.avatar,
  });
  const [errors, setErrors] = useState({});
  const displayUser = user || emptyUserData;

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        const response = await api.get("/api/user/me");
        const profile = response?.data ?? response;
        const nextUser = {
          ...initialUserData,
          userCode: profile.userCode ?? "",
          name: profile.full_name ?? "",
          email: profile.email ?? "",
          phone: profile.phone ?? "",
          department: profile.department ?? "",
          position: profile.position ?? "",
          role: profile.role ?? "",
          joinDate: formatJoinDate(profile.createdAt),
        };

        if (!isMounted) return;
        setUser(nextUser);
        setEditForm({
          userCode: nextUser.userCode,
          name: nextUser.name,
          email: nextUser.email,
          phone: nextUser.phone,
          department: nextUser.department,
          position: nextUser.position,
          avatar: nextUser.avatar,
        });
      } catch (error) {
        if (isMounted) {
          setLoadError(error.message || "Không thể tải thông tin hồ sơ.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleEditClick = () => {
    setEditForm({
      userCode: user?.userCode ?? "",
      name: user?.name ?? "",
      email: user?.email ?? "",
      phone: user?.phone ?? "",
      department: user?.department ?? "",
      position: user?.position ?? "",
      avatar: user?.avatar ?? null,
    });
    setErrors({});
    setIsEditing(true);
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setToastMessage("Ảnh tải lên vượt quá dung lượng 5MB");
        setTimeout(() => setToastMessage(""), 3000);
        return;
      }
      const url = URL.createObjectURL(file);
      setEditForm({ ...editForm, avatar: url });
    }
  };

  const validateForm = () => {
    const newErrors = {};
    const fullNameError = validateFullName(editForm.name);
    const emailError = validateEmail(editForm.email);
    const phoneError = validatePhone(editForm.phone);

    if (fullNameError) newErrors.name = fullNameError;
    if (emailError) newErrors.email = emailError;
    if (phoneError) newErrors.phone = phoneError;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    try {
      const payload = {
        fullName: editForm.name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
      };

      const updatedProfile = await api.put("/api/user/me", payload);
      const nextUser = {
        ...user,
        userCode: updatedProfile.userCode ?? user?.userCode ?? "",
        name:
          updatedProfile.full_name ??
          updatedProfile.fullName ??
          editForm.name.trim(),
        email: updatedProfile.email ?? editForm.email.trim(),
        phone: updatedProfile.phone ?? editForm.phone.trim(),
        department: updatedProfile.department ?? user?.department ?? "",
        position: updatedProfile.position ?? user?.position ?? "",
        role: updatedProfile.role ?? user?.role ?? "",
      };

      setUser(nextUser);
      setEditForm({
        userCode: nextUser.userCode,
        name: nextUser.name,
        email: nextUser.email,
        phone: nextUser.phone,
        department: nextUser.department,
        position: nextUser.position,
        avatar: nextUser.avatar,
      });
      setErrors({});
      setIsEditing(false);
      setToastMessage("Đã lưu thay đổi thành công!");
      setTimeout(() => setToastMessage(""), 3000);
    } catch (error) {
      const nextErrors = {};

      if (error?.code === "EMAIL_ALREADY_EXISTS") {
        nextErrors.email = "Email này đã được sử dụng bởi tài khoản khác.";
      } else if (error?.code === "PHONE_ALREADY_EXISTS") {
        nextErrors.phone =
          "Số điện thoại này đã được sử dụng bởi tài khoản khác.";
      } else if (error?.code === "INVALID_EMAIL") {
        nextErrors.email = error.message || "Email không hợp lệ.";
      } else if (error?.code === "INVALID_PHONE") {
        nextErrors.phone = error.message || "Số điện thoại không hợp lệ.";
      } else if (error?.code === "INVALID_FULL_NAME") {
        nextErrors.name = error.message || "Họ và tên không hợp lệ.";
      } else if (error?.message) {
        setToastMessage(error.message);
        setTimeout(() => setToastMessage(""), 3000);
      }

      setErrors(nextErrors);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!passwordForm.oldPassword) {
      nextErrors.oldPassword = "Vui lòng nhập mật khẩu hiện tại";
    }
    nextErrors.newPassword = validatePassword(passwordForm.newPassword);
    nextErrors.confirmPassword = validateConfirmPassword(
      passwordForm.confirmPassword,
      passwordForm.newPassword,
    );
    const validErrors = Object.fromEntries(
      Object.entries(nextErrors).filter(([, message]) => message),
    );

    if (!isPasswordValid(passwordForm.newPassword)) {
      setPasswordErrors(validErrors);
      return;
    }

    setPasswordErrors(validErrors);
    if (Object.keys(validErrors).length > 0) return;

    setIsChangingPassword(true);
    try {
      await api.put("/api/user/change-password", {
        oldPassword: passwordForm.oldPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordErrors({});
      setShowPasswordSuccess(true);
    } catch (error) {
      setPasswordErrors({ form: error?.message || "Không thể đổi mật khẩu" });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="dashboard-shell profile-page-shell">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="profile-toast">
          {icons.check}
          <span>{toastMessage}</span>
        </div>
      )}

      {showPasswordSuccess && (
        <div
          className="password-success-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-success-title"
        >
          <div className="password-success-modal">
            <div className="password-success-brand">
              <div className="auth-logo-mark">
                <span />
              </div>
              <strong>
                Smart<span>Rec</span>
              </strong>
            </div>
            <div className="password-success-icon">{icons.check}</div>
            <h2 id="password-success-title">Đổi mật khẩu thành công!</h2>
            <p>
              Mật khẩu của bạn đã được cập nhật. Bạn có thể đăng nhập với mật
              khẩu mới.
            </p>
            <button
              className="btn-save password-success-button"
              type="button"
              onClick={() => setShowPasswordSuccess(false)}
            >
              Xác nhận
            </button>
          </div>
        </div>
      )}

      {/* ── Settings Sidebar ── */}
      <aside className="profile-sidebar">
        <div className="profile-sidebar-top">
          {/* Brand */}
          <div className="sidebar-brand">
            <div className="auth-logo-mark">
              <span />
            </div>
            <strong>
              Smart<span>Rec</span>
            </strong>
          </div>

          {/* Settings section label */}
          <div className="profile-sidebar-label">CÀI ĐẶT</div>

          {/* Tabs */}
          <nav className="profile-sidebar-nav">
            {settingsTabs.map((tab) => (
              <button
                key={tab.key}
                className={`profile-sidebar-link${activeTab === tab.key ? " is-active" : ""}`}
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
            <button className="profile-home-btn" onClick={() => navigate("/")}>
              {icons.home}
              <span>Về trang chủ</span>
            </button>
            <div className="topbar-avatar">
              {displayUser.avatar ? (
                <img
                  src={displayUser.avatar}
                  alt="Avatar"
                  className="avatar-circle"
                  style={{ padding: 0, objectFit: "cover" }}
                />
              ) : (
                <div className="avatar-circle">
                  {displayUser.name
                    ? displayUser.name
                        .split(" ")
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()
                    : "--"}
                </div>
              )}
              <div className="avatar-info">
                <span className="avatar-name">
                  {displayUser.name || "Đang tải..."}
                </span>
                <span className="avatar-role">{displayUser.role || " "}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="dashboard-content">
          {isLoading && (
            <div style={{ color: "var(--sr-muted)", fontSize: 13 }}>
              Đang tải thông tin...
            </div>
          )}

          {!isLoading && loadError && (
            <div style={{ color: "var(--sr-error)", fontSize: 13 }}>
              {loadError}
            </div>
          )}

          {!isLoading && !loadError && (
            <>
              {/* ══════════════ TAB: Hồ sơ cá nhân (Chế độ Edit) ══════════════ */}
              {activeTab === "profile" && isEditing && (
                <div className="profile-edit-section">
                  <div className="profile-edit-header">
                    <h1>Chỉnh sửa hồ sơ</h1>
                    <div className="profile-edit-actions">
                      <button
                        className="btn-cancel"
                        onClick={() => setIsEditing(false)}
                      >
                        Hủy bỏ
                      </button>
                      <button className="btn-save" onClick={handleSave}>
                        Lưu thay đổi
                      </button>
                    </div>
                  </div>

                  <div className="profile-edit-form-wrap">
                    {/* Avatar section */}
                    <div className="profile-edit-avatar-box">
                      <div className="profile-avatar-ring large">
                        {editForm.avatar ? (
                          <img
                            src={editForm.avatar}
                            alt="Avatar Preview"
                            className="profile-avatar-img"
                          />
                        ) : (
                          <div className="profile-avatar-placeholder">
                            <svg
                              width="48"
                              height="48"
                              viewBox="0 0 48 48"
                              fill="none"
                            >
                              <circle
                                cx="24"
                                cy="18"
                                r="9"
                                stroke="currentColor"
                                strokeWidth="2"
                              />
                              <path
                                d="M6 44c0-9.94 8.06-18 18-18s18 8.06 18 18"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          </div>
                        )}
                        <input
                          type="file"
                          id="avatar-upload"
                          accept="image/png, image/jpeg"
                          style={{ display: "none" }}
                          onChange={handleAvatarChange}
                        />
                        <button
                          className="avatar-edit-btn"
                          title="Đổi ảnh đại diện"
                          onClick={() =>
                            document.getElementById("avatar-upload").click()
                          }
                        >
                          {icons.pen}
                        </button>
                      </div>
                      <span className="avatar-upload-hint">
                        Tải lên ảnh PNG hoặc JPG (Tối đa 5MB)
                      </span>
                    </div>

                    {/* Form fields */}
                    <div className="profile-form-grid">
                      <div className="form-group">
                        <label>MÃ ID</label>
                        <input
                          type="text"
                          value={editForm.userCode || ""}
                          className="profile-input"
                          readOnly
                        />
                      </div>

                      <div className="form-group">
                        <label>HỌ VÀ TÊN</label>
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) =>
                            setEditForm({ ...editForm, name: e.target.value })
                          }
                          className={`profile-input ${errors.name ? "input-error" : ""}`}
                        />
                        {errors.name && (
                          <span className="error-text">{errors.name}</span>
                        )}
                      </div>

                      <div className="form-group">
                        <label>EMAIL</label>
                        <input
                          type="email"
                          value={editForm.email}
                          onChange={(e) =>
                            setEditForm({ ...editForm, email: e.target.value })
                          }
                          className={`profile-input ${errors.email ? "input-error" : ""}`}
                        />
                        {errors.email && (
                          <span className="error-text">{errors.email}</span>
                        )}
                      </div>

                      <div className="form-group">
                        <label>SỐ ĐIỆN THOẠI</label>
                        <input
                          type="text"
                          value={editForm.phone}
                          onChange={(e) =>
                            setEditForm({ ...editForm, phone: e.target.value })
                          }
                          className={`profile-input ${errors.phone ? "input-error" : ""}`}
                        />
                        {errors.phone && (
                          <span className="error-text">{errors.phone}</span>
                        )}
                      </div>

                      <div className="form-group">
                        <label>PHÒNG BAN</label>
                        <input
                          type="text"
                          value={editForm.department || ""}
                          className="profile-input"
                          readOnly
                        />
                      </div>

                      <div className="form-group">
                        <label>CHỨC VỤ</label>
                        <input
                          type="text"
                          value={editForm.position || ""}
                          className="profile-input"
                          readOnly
                        />
                      </div>
                    </div>

                    {/* Notices */}
                    <div className="profile-notice-box security-notice">
                      <div className="notice-icon">{icons.bulb}</div>
                      <div className="notice-text">
                        <strong>Lưu ý bảo mật</strong>
                        <p>
                          Chỉ các trường Họ và tên, Email và Số điện thoại được
                          phép cập nhật từ hồ sơ cá nhân.
                        </p>
                      </div>
                    </div>

                    <div className="profile-notice-box tip-notice">
                      <div className="notice-icon">{icons.bulb}</div>
                      <div className="notice-text">
                        <strong>Mẹo nhỏ</strong>
                        <p>
                          Mã ID, phòng ban và chức vụ là dữ liệu hệ thống, do đó
                          chỉ hiển thị và không thay đổi từ màn hình này.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ══════════════ TAB: Hồ sơ cá nhân (Chế độ Xem) ══════════════ */}
              {activeTab === "profile" && !isEditing && (
                <div className="profile-section">
                  <div className="profile-section-header">
                    <h1>Thông tin cá nhân</h1>
                    <button
                      className="profile-edit-btn"
                      onClick={handleEditClick}
                    >
                      {icons.edit}
                      <span>Chỉnh sửa</span>
                    </button>
                  </div>

                  <div className="profile-info-card">
                    <div className="profile-avatar-col">
                      <div className="profile-avatar-ring">
                        {displayUser.avatar ? (
                          <img
                            src={displayUser.avatar}
                            alt="Avatar"
                            className="profile-avatar-img"
                          />
                        ) : (
                          <div className="profile-avatar-placeholder">
                            <svg
                              width="48"
                              height="48"
                              viewBox="0 0 48 48"
                              fill="none"
                            >
                              <circle
                                cx="24"
                                cy="18"
                                r="9"
                                stroke="currentColor"
                                strokeWidth="2"
                              />
                              <path
                                d="M6 44c0-9.94 8.06-18 18-18s18 8.06 18 18"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                      <h3 className="profile-avatar-name">
                        {displayUser.name}
                      </h3>
                      <span className="profile-avatar-email">
                        {displayUser.email}
                      </span>
                      <span className="profile-role-badge">
                        {displayUser.role}
                      </span>
                    </div>

                    <div className="profile-details-grid">
                      <div className="profile-detail-item">
                        <span className="profile-detail-label">MÃ ID</span>
                        <span className="profile-detail-value">
                          {displayUser.userCode || ""}
                        </span>
                      </div>
                      <div className="profile-detail-item">
                        <span className="profile-detail-label">HỌ VÀ TÊN</span>
                        <span className="profile-detail-value">
                          {displayUser.name || ""}
                        </span>
                      </div>
                      <div className="profile-detail-item">
                        <span className="profile-detail-label">EMAIL</span>
                        <span className="profile-detail-value">
                          {displayUser.email || ""}
                        </span>
                      </div>
                      <div className="profile-detail-item">
                        <span className="profile-detail-label">
                          SỐ ĐIỆN THOẠI
                        </span>
                        <span className="profile-detail-value">
                          {displayUser.phone || ""}
                        </span>
                      </div>
                      <div className="profile-detail-item">
                        <span className="profile-detail-label">PHÒNG BAN</span>
                        <span className="profile-detail-value">
                          {displayUser.department || ""}
                        </span>
                      </div>
                      <div className="profile-detail-item">
                        <span className="profile-detail-label">CHỨC VỤ</span>
                        <span className="profile-detail-value">
                          {displayUser.position || ""}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "password" && (
                <div className="profile-section password-section">
                  <div className="profile-section-header">
                    <div>
                      <h1>Đổi mật khẩu</h1>
                      <p className="profile-section-desc">
                        Cập nhật mật khẩu để bảo vệ tài khoản của bạn.
                      </p>
                    </div>
                  </div>

                  <form
                    className="password-form-card"
                    onSubmit={handleChangePassword}
                  >
                    <div className="password-form-icon">{icons.lock}</div>
                    <div className="password-form-fields">
                      <div className="form-group">
                        <label htmlFor="old-password">MẬT KHẨU HIỆN TẠI</label>
                        <div className="password-input-wrap">
                          <input
                            id="old-password"
                            className={`profile-input ${passwordErrors.oldPassword ? "input-error" : ""}`}
                            type={
                              visiblePasswords.oldPassword ? "text" : "password"
                            }
                            value={passwordForm.oldPassword}
                            onChange={(event) =>
                              setPasswordForm({
                                ...passwordForm,
                                oldPassword: event.target.value,
                              })
                            }
                            autoComplete="current-password"
                          />
                          <button
                            className="password-visibility-button"
                            type="button"
                            aria-label={
                              visiblePasswords.oldPassword
                                ? "Ẩn mật khẩu hiện tại"
                                : "Hiện mật khẩu hiện tại"
                            }
                            onClick={() =>
                              setVisiblePasswords({
                                ...visiblePasswords,
                                oldPassword: !visiblePasswords.oldPassword,
                              })
                            }
                          >
                            {visiblePasswords.oldPassword
                              ? icons.eyeOff
                              : icons.eye}
                          </button>
                        </div>
                        {passwordErrors.oldPassword && (
                          <span className="error-text">
                            {passwordErrors.oldPassword}
                          </span>
                        )}
                      </div>

                      <div className="form-group">
                        <label htmlFor="new-password">MẬT KHẨU MỚI</label>
                        <div className="password-input-wrap">
                          <input
                            id="new-password"
                            className={`profile-input ${passwordErrors.newPassword ? "input-error" : ""}`}
                            type={
                              visiblePasswords.newPassword ? "text" : "password"
                            }
                            value={passwordForm.newPassword}
                            onChange={(event) =>
                              setPasswordForm({
                                ...passwordForm,
                                newPassword: event.target.value,
                              })
                            }
                            autoComplete="new-password"
                          />
                          <button
                            className="password-visibility-button"
                            type="button"
                            aria-label={
                              visiblePasswords.newPassword
                                ? "Ẩn mật khẩu mới"
                                : "Hiện mật khẩu mới"
                            }
                            onClick={() =>
                              setVisiblePasswords({
                                ...visiblePasswords,
                                newPassword: !visiblePasswords.newPassword,
                              })
                            }
                          >
                            {visiblePasswords.newPassword
                              ? icons.eyeOff
                              : icons.eye}
                          </button>
                        </div>
                        {passwordErrors.newPassword && (
                          <span className="error-text">
                            {passwordErrors.newPassword}
                          </span>
                        )}
                      </div>

                      <div className="form-group">
                        <label htmlFor="confirm-password">
                          XÁC NHẬN MẬT KHẨU MỚI
                        </label>
                        <div className="password-input-wrap">
                          <input
                            id="confirm-password"
                            className={`profile-input ${passwordErrors.confirmPassword ? "input-error" : ""}`}
                            type={
                              visiblePasswords.confirmPassword
                                ? "text"
                                : "password"
                            }
                            value={passwordForm.confirmPassword}
                            onChange={(event) =>
                              setPasswordForm({
                                ...passwordForm,
                                confirmPassword: event.target.value,
                              })
                            }
                            autoComplete="new-password"
                          />
                          <button
                            className="password-visibility-button"
                            type="button"
                            aria-label={
                              visiblePasswords.confirmPassword
                                ? "Ẩn xác nhận mật khẩu"
                                : "Hiện xác nhận mật khẩu"
                            }
                            onClick={() =>
                              setVisiblePasswords({
                                ...visiblePasswords,
                                confirmPassword:
                                  !visiblePasswords.confirmPassword,
                              })
                            }
                          >
                            {visiblePasswords.confirmPassword
                              ? icons.eyeOff
                              : icons.eye}
                          </button>
                        </div>
                        {passwordErrors.confirmPassword && (
                          <span className="error-text">
                            {passwordErrors.confirmPassword}
                          </span>
                        )}
                      </div>

                      <div className="password-requirements-note">
                        Mật khẩu mới gồm 8-16 ký tự, có chữ hoa, chữ thường, chữ
                        số và ký tự đặc biệt.
                      </div>
                      {passwordErrors.form && (
                        <div className="password-form-error">
                          {passwordErrors.form}
                        </div>
                      )}
                      <button
                        className="btn-save password-submit"
                        type="submit"
                        disabled={isChangingPassword}
                      >
                        {isChangingPassword
                          ? "Đang cập nhật..."
                          : "Đổi mật khẩu"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* ══════════════ TAB: Vai trò & Phân quyền ══════════════ */}
              {activeTab === "roles" && (
                <div className="profile-section">
                  <div className="profile-section-header">
                    <div>
                      <h1>Quản lý vai trò</h1>
                      <p className="profile-section-desc">
                        Xác định các mức độ truy cập và quyền hạn cho các thành
                        viên trong Workspace.
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
                        Bạn có thể tùy chỉnh từng quyền hạn cụ thể cho thành
                        viên trong phần Quản lý Workspace. Đừng quên lưu lại
                        thay đổi sau khi cập nhật nhé!
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
