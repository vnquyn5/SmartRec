import React from "react";
import { Navigate, Routes, Route } from "react-router-dom";

import DashboardLayout from "../components/layout/DashboardLayout";
import UploadPage from "../pages/upload/UploadPage";
import FileManagerPage from "../pages/meeting/FileManagerPage";
import MeetingDetailPage from "../pages/meeting/MeetingDetailPage";
import TrashPage from "../pages/trash/TrashPage";

import LoginPage from "../pages/auth/LoginPage";
import RegisterPage from "../pages/auth/RegisterPage";
import ForgotPasswordPage from "../pages/auth/ForgotPasswordPage";
import ProfilePage from "../pages/auth/ProfilePage";

import { RequireAuth } from "../features/auth/RequireAuth";

const AppRoutes = () => {
  return (
    <Routes>
      {/* Authentication */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      {/* Protected routes */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Navigate to="/history" replace />} />
        <Route path="/dashboard" element={<Navigate to="/history" replace />} />
        <Route path="/workspace" element={<Navigate to="/history" replace />} />
        <Route element={<DashboardLayout />}>
          <Route path="/meeting/:id" element={<MeetingDetailPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/upload/large" element={<Navigate to="/upload" replace />} />
          <Route path="/history" element={<FileManagerPage />} />
          <Route path="/trash" element={<TrashPage />} />
        </Route>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/history" replace />} />
      </Route>
    </Routes>
  );
};

export default AppRoutes;
