import React from "react";
import { Routes, Route } from "react-router-dom";

import DashboardPage from "../pages/dashboard/DashboardPage";
import UploadPage from "../pages/upload/UploadPage";
import FileManagerPage from "../pages/meeting/FileManagerPage";

import LoginPage from "../pages/auth/LoginPage";
import RegisterPage from "../pages/auth/RegisterPage";
import ForgotPasswordPage from "../pages/auth/ForgotPasswordPage";
import ProfilePage from "../pages/auth/ProfilePage";

import { RequireAuth } from "../features/auth/RequireAuth";

const Meeting = () => <div className="p-4">Meeting Details</div>;

const AppRoutes = () => {
  return (
    <Routes>
      {/* Authentication */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      {/* Protected routes */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/meeting/:id" element={<Meeting />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/history" element={<FileManagerPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  );
};

export default AppRoutes;
