import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatsCards from "../../components/dashboard/StatsCards";
import MeetingChart from "../../components/dashboard/MeetingChart";
import RecentMeetings from "../../components/dashboard/RecentMeetings";
import { useAuth } from "../../features/auth/AuthProvider";
import { getAllMeetings, getMeetings } from "../../services/meetingService";

const DashboardPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const displayName = user?.name || "Đang tải...";
  const [meetings, setMeetings] = useState([]);
  const [totalMeetings, setTotalMeetings] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [recentPage, setRecentPage] = useState(0);
  const [recentStatus, setRecentStatus] = useState("");
  const [recentData, setRecentData] = useState({
    content: [],
    pageNumber: 0,
    pageSize: 4,
    totalElements: 0,
    totalPages: 0,
    first: true,
    last: true,
  });
  const [recentLoading, setRecentLoading] = useState(true);
  const [chartRange, setChartRange] = useState("week");
  const [chartMeetings, setChartMeetings] = useState([]);
  const [chartLoading, setChartLoading] = useState(true);

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

  useEffect(() => {
    let isMounted = true;

    const loadRecentMeetings = async () => {
      setRecentLoading(true);
      try {
        const response = await getMeetings({
          page: recentPage,
          size: 4,
          status: recentStatus,
        });
        if (!isMounted) return;
        setRecentData(response);
      } catch (error) {
        if (isMounted)
          setLoadError(error?.message || "Không thể tải cuộc họp gần đây.");
      } finally {
        if (isMounted) setRecentLoading(false);
      }
    };

    loadRecentMeetings();
    return () => {
      isMounted = false;
    };
  }, [recentPage, recentStatus]);

  useEffect(() => {
    let isMounted = true;

    const loadChartMeetings = async () => {
      setChartLoading(true);
      try {
        const response = await getAllMeetings();
        if (!isMounted) return;
        setChartMeetings(response.content);
      } catch (error) {
        if (isMounted)
          setLoadError(error?.message || "Không thể tải dữ liệu biểu đồ.");
      } finally {
        if (isMounted) setChartLoading(false);
      }
    };

    loadChartMeetings();
    return () => {
      isMounted = false;
    };
  }, [chartRange]);

  return (
    <>
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
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            style={{ marginRight: 8 }}
          >
            <path
              d="M10 13V3m0 0L6 7m4-4 4 4M4 12v4a1 1 0 001 1h10a1 1 0 001-1v-4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Tải lên
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
        <MeetingChart
          meetings={chartMeetings}
          isLoading={chartLoading}
          range={chartRange}
          onRangeChange={setChartRange}
        />
        <RecentMeetings
          meetings={recentData.content}
          totalMeetings={recentData.totalElements}
          pageNumber={recentData.pageNumber}
          pageSize={recentData.pageSize}
          totalPages={recentData.totalPages}
          first={recentData.first}
          last={recentData.last}
          status={recentStatus}
          onStatusChange={(nextStatus) => {
            setRecentStatus(nextStatus);
            setRecentPage(0);
          }}
          onPageChange={setRecentPage}
          isLoading={recentLoading}
        />
      </div>
    </>
  );
};

export default DashboardPage;
