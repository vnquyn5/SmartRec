import React from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const DashboardLayout = ({ children, title, showBack, onBack, searchQuery, onSearchChange }) => {
  return (
    <div className="dashboard-shell">
      <Sidebar />
      <div className="dashboard-main">
        <TopBar 
          title={title} 
          showBack={showBack} 
          onBack={onBack} 
          searchQuery={searchQuery} 
          onSearchChange={onSearchChange} 
        />
        <div className="dashboard-content">
          {children}
        </div>
      </div>
    </div>
  );
};

export default DashboardLayout;
