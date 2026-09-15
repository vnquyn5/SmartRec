import React from 'react';
import { Routes, Route } from 'react-router-dom';
import PrivateRoute from './PrivateRoute';
import LoginPage from '../pages/auth/LoginPage';
import RegisterPage from '../pages/auth/RegisterPage';
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage';

// Placeholder components
const Dashboard = () => <div className="p-4">Dashboard</div>;
const Meeting = () => <div className="p-4">Meeting Details</div>;

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/meeting/:id" element={<PrivateRoute><Meeting /></PrivateRoute>} />
    </Routes>
  );
};

export default AppRoutes;
