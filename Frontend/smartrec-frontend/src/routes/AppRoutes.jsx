import React from "react";
import { Routes, Route } from "react-router-dom";

import DashboardLayout from "../components/layout/DashboardLayout";
import DashboardPage from "../pages/dashboard/DashboardPage";
import UploadPage from "../pages/upload/UploadPage";
import LargeFileUploadPage from "../pages/upload/LargeFileUploadPage";
import FileManagerPage from "../pages/meeting/FileManagerPage";
import MeetingDetailPage from "../pages/meeting/MeetingDetailPage";

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
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/meeting/:id" element={<MeetingDetailPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/upload/large" element={<LargeFileUploadPage />} />
          <Route path="/history" element={<FileManagerPage />} />
        </Route>
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  );
};

export default AppRoutes;
