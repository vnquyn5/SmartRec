import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { PageHeaderProvider } from "./PageHeaderContext.jsx";

const DashboardLayout = () => {
  const { pathname } = useLocation();
  const isMeetingDetails = /^\/meeting\/[^/]+\/?$/.test(pathname);
  const isUploadPage = pathname === "/upload";
  const isHistoryPage = pathname === "/history";
  const isTrashPage = pathname === "/trash";

  return (
    <PageHeaderProvider key={pathname} pathname={pathname}>
      <div className={`dashboard-shell${isMeetingDetails ? " meeting-details-shell" : ""}${isHistoryPage ? " history-scroll-shell" : ""}${isTrashPage ? " trash-scroll-shell" : ""}`}>
        <Sidebar />
        <div className="dashboard-main">
          <TopBar hideSearch />
          <div className={`dashboard-content${isMeetingDetails ? " meeting-details-content" : ""}${isUploadPage ? " upload-page-content" : ""}${isHistoryPage ? " history-scroll-content" : ""}${isTrashPage ? " trash-scroll-content" : ""}`}>
            <Outlet />
          </div>
        </div>
      </div>
    </PageHeaderProvider>
  );
};

export default DashboardLayout;
