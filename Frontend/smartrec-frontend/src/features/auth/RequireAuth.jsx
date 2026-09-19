import React from "react";
import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider.jsx";

export function RequireAuth({ roles }) {
  const { status, hasRole } = useAuth();
  const location = useLocation();

  if (status === "bootstrapping") {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          background: "var(--sr-bg, #0f172a)",
        }}
      >
        <div>Đang tải phiên làm việc...</div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && !roles.some(hasRole)) {
    return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}
