import React from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import StatsCards from '../../components/dashboard/StatsCards';
import MeetingChart from '../../components/dashboard/MeetingChart';
import RecentMeetings from '../../components/dashboard/RecentMeetings';

const DashboardPage = () => {
  const navigate = useNavigate();
  const displayName = 'Alex';

  return (
    <DashboardLayout>
      <div className="dashboard-welcome-row">
        <div className="dashboard-welcome">
          <h1>Welcome Back, {displayName}</h1>
          <p>Trợ lý AI hợp thông minh của bạn đã sẵn sàng</p>
        </div>
        <button className="sr-button sr-button-primary new-upload-btn" onClick={() => navigate('/upload')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: 8 }}>
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          New Upload
        </button>
      </div>

      <StatsCards />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', alignItems: 'stretch' }}>
        <MeetingChart />
        <RecentMeetings />
      </div>
    </DashboardLayout>
  );
};

export default DashboardPage;
