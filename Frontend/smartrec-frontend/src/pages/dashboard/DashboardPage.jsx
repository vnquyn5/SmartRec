import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/layout/DashboardLayout";
import StatsCards from "../../components/dashboard/StatsCards";
import MeetingChart from "../../components/dashboard/MeetingChart";
import RecentMeetings from "../../components/dashboard/RecentMeetings";
import { useAuth } from "../../features/auth/AuthProvider";
import { getAllMeetings } from "../../services/meetingService";

const DashboardPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const displayName = user?.name || "Đang tải...";
  const [meetings, setMeetings] = useState([]);
  const [totalMeetings, setTotalMeetings] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadDashboardMeetings = async () => {
      try {
        const response = await getAllMeetings();
        if (!isMounted) return;
        setMeetings(response.content);
        setTotalMeetings(response.totalElements);
      } catch (error) {
        if (isMounted)
          setLoadError(error?.message || "Không thể tải dữ liệu Dashboard.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadDashboardMeetings();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <DashboardLayout>
      <div className="dashboard-welcome-row">
        <div className="dashboard-welcome">
          <h1>Chào mừng trở lại, {displayName}</h1>
          <p>Trợ lý AI hợp thông minh của bạn đã sẵn sàng</p>
        </div>
        <button
          className="sr-button sr-button-primary new-upload-btn"
          onClick={() => navigate("/upload")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ marginRight: 8 }}
          >
            <path
              d="M8 2v12M2 8h12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          New Upload
        </button>
      </div>

      {loadError && <div className="dashboard-data-error">{loadError}</div>}
      <StatsCards
        meetings={meetings}
        totalMeetings={totalMeetings}
        isLoading={isLoading}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "24px",
          alignItems: "stretch",
        }}
      >
        <MeetingChart meetings={meetings} isLoading={isLoading} />
        <RecentMeetings
          meetings={meetings}
          totalMeetings={totalMeetings}
          isLoading={isLoading}
        />
      </div>
    </DashboardLayout>
  );
};

export default DashboardPage;
