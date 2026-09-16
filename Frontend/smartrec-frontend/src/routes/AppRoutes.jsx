import React from 'react';
import { Routes, Route } from 'react-router-dom';
import DashboardPage from '../pages/dashboard/DashboardPage';
import UploadPage from '../pages/upload/UploadPage';

// Placeholder components
const Meeting = () => <div className="p-4">Meeting Details</div>;

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/meeting/:id" element={<Meeting />} />
      <Route path="/upload" element={<UploadPage />} />
    </Routes>
  );
};

export default AppRoutes;
