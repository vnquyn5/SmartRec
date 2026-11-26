import React, { Suspense } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { PageHeaderProvider } from "./PageHeaderContext.jsx";
import ErrorBoundary from "../common/ErrorBoundary.jsx";

const DashboardLayout = () => {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const isMeetingDetails = /^\/meeting\/[^/]+\/?$/.test(pathname);
  const isUploadPage = pathname === "/upload";
  const isHistoryPage = pathname === "/history";
  const isTrashPage = pathname === "/trash";
  const isStorageAdmin = pathname.startsWith("/admin/storage");

  return (
    <PageHeaderProvider key={pathname} pathname={pathname}>
      <div className={`dashboard-shell${isMeetingDetails ? " meeting-details-shell" : ""}${isHistoryPage ? " history-scroll-shell" : ""}${isTrashPage ? " trash-scroll-shell" : ""}`}>
        <Sidebar />
        <div className="dashboard-main">
          <TopBar hideSearch />
          <div className={`dashboard-content${isMeetingDetails ? " meeting-details-content" : ""}${isUploadPage ? " upload-page-content" : ""}${isHistoryPage ? " history-scroll-content" : ""}${isTrashPage ? " trash-scroll-content" : ""}${isStorageAdmin ? " !px-3 sm:!px-4 !pt-5 !pb-10 !max-w-none" : ""}`}>
            <ErrorBoundary
              level="page"
              resetKeys={[pathname, search]}
              onNavigateHome={() => navigate("/history")}
            >
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="w-full min-h-[240px] flex items-center justify-center p-6 text-xs text-slate-400"
                  >
                    Đang tải trang...
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </PageHeaderProvider>
  );
};

export default DashboardLayout;
