import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthProvider.jsx";

const PrivateRoute = ({ children }) => {
  const { status } = useAuth();

  if (status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default PrivateRoute;
