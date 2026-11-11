import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

const DashboardLayout = () => {
  const { pathname } = useLocation();
  const isMeetingDetails = /^\/meeting\/[^/]+\/?$/.test(pathname);
  const isUploadPage = pathname === "/upload";

  return (
    <div className={`dashboard-shell${isMeetingDetails ? " meeting-details-shell" : ""}`}>
      <Sidebar />
      <div className="dashboard-main">
        <TopBar hideSearch />
        <div className={`dashboard-content${isMeetingDetails ? " meeting-details-content" : ""}${isUploadPage ? " upload-page-content" : ""}`}>
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default DashboardLayout;
