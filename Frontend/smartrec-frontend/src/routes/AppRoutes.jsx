import React, { Suspense, lazy } from "react";
import { Navigate, Routes, Route, useLocation, useNavigate } from "react-router-dom";

import DashboardLayout from "../components/layout/DashboardLayout";
import ErrorBoundary from "../components/common/ErrorBoundary";
import { RequireAuth } from "../features/auth/RequireAuth";

import LoginPage from "../pages/auth/LoginPage";
import RegisterPage from "../pages/auth/RegisterPage";
import ForgotPasswordPage from "../pages/auth/ForgotPasswordPage";

const UploadPage = lazy(() => import("../pages/upload/UploadPage"));
const FileManagerPage = lazy(() => import("../pages/meeting/FileManagerPage"));
const MeetingDetailPage = lazy(() => import("../pages/meeting/MeetingDetailPage"));
const GuestMeetingPage = lazy(() => import("../pages/meeting/GuestMeetingPage"));
const TrashPage = lazy(() => import("../pages/trash/TrashPage"));
const WorkspacePage = lazy(() => import("../pages/workspace/WorkspacePage"));
const ModelGovernancePage = lazy(() => import("../pages/governance/ModelGovernancePage"));
const StorageAdminPage = lazy(() => import("../pages/storage/StorageAdminPage"));
const DocumentExportPage = lazy(() => import("../pages/export/DocumentExportPage"));
const ProfilePage = lazy(() => import("../pages/auth/ProfilePage"));

const RealtimeStepperInteractiveTest = lazy(() =>
  import("../components/meeting/RealtimeStepperInteractiveTest")
);
const ExplainabilityDrawerInteractiveTest = lazy(() =>
  import("../components/meeting/ExplainabilityDrawerInteractiveTest")
);
const ShareManagementInteractiveTest = lazy(() =>
  import("../components/meeting/ShareManagementInteractiveTest")
);

function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full min-h-[280px] flex items-center justify-center p-6 text-xs text-slate-400"
    >
      <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-[#1b2640] bg-[#0c1324] text-slate-300 shadow-sm">
        <span className="w-2 h-2 rounded-full bg-[#38bdf8] animate-ping" />
        <span>Đang tải không gian làm việc...</span>
      </div>
    </div>
  );
}

function GuardedRouteSection({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <ErrorBoundary
      level="page"
      resetKeys={[location.pathname, location.search]}
      onNavigateHome={() => navigate("/history")}
    >
      <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

const AppRoutes = () => {
  return (
    <GuardedRouteSection>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        <Route path="/shared/meeting/:id" element={<GuestMeetingPage />} />
        <Route path="/public/meeting/:id" element={<GuestMeetingPage />} />
        <Route path="/share/:id" element={<GuestMeetingPage />} />
        <Route
          path="/test/stepper"
          element={
            <div className="min-h-screen bg-[#060b17] p-6">
              <RealtimeStepperInteractiveTest />
            </div>
          }
        />
        <Route
          path="/test/explainability"
          element={
            <div className="min-h-screen bg-[#060b17] p-6">
              <ExplainabilityDrawerInteractiveTest />
            </div>
          }
        />
        <Route
          path="/test/share-modal"
          element={
            <div className="min-h-screen bg-[#060b17] p-6">
              <ShareManagementInteractiveTest />
            </div>
          }
        />

        <Route element={<RequireAuth />}>
          <Route path="/" element={<Navigate to="/history" replace />} />
          <Route path="/dashboard" element={<Navigate to="/history" replace />} />
          <Route element={<DashboardLayout />}>
            <Route path="/meeting/:id" element={<MeetingDetailPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/upload/large" element={<Navigate to="/upload" replace />} />
            <Route path="/history" element={<FileManagerPage />} />
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/governance" element={<ModelGovernancePage />} />
            <Route path="/admin/storage" element={<StorageAdminPage />} />
            <Route path="/export" element={<DocumentExportPage />} />
            <Route path="/trash" element={<TrashPage />} />
          </Route>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/history" replace />} />
        </Route>
      </Routes>
    </GuardedRouteSection>
  );
};

export default AppRoutes;
