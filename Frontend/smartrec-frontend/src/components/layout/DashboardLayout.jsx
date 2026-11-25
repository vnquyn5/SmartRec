import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

const DashboardLayout = () => {
  const location = useLocation();
  const isMeetingDetail = location.pathname.startsWith("/meeting/");
  const isStorageAdmin = location.pathname.startsWith("/admin/storage");

  return (
    <div className="dashboard-shell">
      <Sidebar />
      <div className="dashboard-main">
        {!isMeetingDetail && <TopBar hideSearch />}
        <div
          className={`dashboard-content ${
            isMeetingDetail
              ? "!p-0 !max-w-none"
              : isStorageAdmin
                ? "!px-3 sm:!px-4 !pt-5 !pb-10 !max-w-none"
                : ""
          }`}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default DashboardLayout;
