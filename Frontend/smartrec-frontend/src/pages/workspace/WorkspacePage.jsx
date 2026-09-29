import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { meetingApi } from "../../api/meetingApi";
import "./WorkspacePage.css";

const mockData = [
  {
    id: 1,
    title: "Q4 Planning Session Final",
    createdAt: "2023-10-24T10:30:00",
    duration: 1710, // 28:30
    thumbnailUrl:
      "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 2,
    title: "Engineering Weekly Sync",
    createdAt: "2023-10-22T09:00:00",
    duration: 2712, // 45:12
    thumbnailUrl:
      "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 3,
    title: "New Product Demo v2.0",
    createdAt: "2023-10-19T14:45:00",
    duration: 725, // 12:05
    thumbnailUrl:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 4,
    title: "Marketing Strategy Brainstorm",
    createdAt: "2023-10-18T11:15:00",
    duration: 1940, // 32:20
    thumbnailUrl:
      "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 5,
    title: "UX Design Review - Mobile",
    createdAt: "2023-10-15T16:30:00",
    duration: 3490, // 58:10
    thumbnailUrl:
      "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=600&q=80",
  },
];

const WorkspacePage = () => {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState(mockData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const fetchMeetings = async () => {
    setLoading(true);
    // Simulate API delay
    setTimeout(() => {
      if (debouncedSearch) {
        const filtered = mockData.filter((m) =>
          m.title.toLowerCase().includes(debouncedSearch.toLowerCase()),
        );
        setMeetings(filtered);
      } else {
        setMeetings(mockData);
      }
      setLoading(false);
    }, 300);
  };

  useEffect(() => {
    fetchMeetings();
  }, [debouncedSearch]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this meeting?"))
      return;

    // Simulate API deletion delay for mock data
    try {
      setMeetings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error("Failed to delete meeting", err);
      alert("Failed to delete the meeting.");
    }
  };

  const handleShare = (id, e) => {
    e.stopPropagation();
    const link = `${window.location.origin}/meeting/${id}`;
    navigator.clipboard.writeText(link);
    alert("Meeting link copied to clipboard!");
  };

  const handleViewInsights = (id) => {
    navigate(`/meeting/${id}`);
  };

  const handleAddAnother = () => {
    navigate("/upload");
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "00:00";
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  };

  const formatDateStr = (dateString) => {
    if (!dateString) return "Unknown Date";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatTimeStr = (dateString) => {
    if (!dateString) return "Unknown Time";
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <div className="workspace-container">
        <div className="workspace-header">
          <h2 className="workspace-title">Cuộc họp đã xử lý</h2>
          <p className="workspace-description">
            Dưới đây là danh sách các cuộc họp đã được xử lý bởi hệ thống. Bạn
            có thể xem chi tiết, chia sẻ hoặc xóa các cuộc họp này.
          </p>
        </div>

        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <p>{error}</p>
            <button
              onClick={fetchMeetings}
              className="btn-action btn-insights"
              style={{ marginTop: "16px", maxWidth: "200px" }}
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="meetings-grid">
            {meetings.map((meeting) => (
              <div
                key={meeting.id}
                className="meeting-card"
                onClick={() => handleViewInsights(meeting.id)}
              >
                <div className="meeting-card-thumbnail">
                  {meeting.thumbnailUrl ? (
                    <img
                      src={meeting.thumbnailUrl}
                      alt={meeting.title || "Meeting"}
                    />
                  ) : (
                    <div className="thumbnail-placeholder">
                      <svg
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.2)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect
                          x="2"
                          y="2"
                          width="20"
                          height="20"
                          rx="2.18"
                          ry="2.18"
                        ></rect>
                        <line x1="7" y1="2" x2="7" y2="22"></line>
                        <line x1="17" y1="2" x2="17" y2="22"></line>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                      </svg>
                    </div>
                  )}
                  <span className="duration-badge">
                    {formatDuration(meeting.duration)}
                  </span>
                </div>

                <div className="meeting-card-content">
                  <div className="meeting-title-row">
                    <h3 className="meeting-card-title">
                      {meeting.title || "Untitled Meeting"}
                    </h3>
                    <span className="status-badge">
                      <span className="status-dot"></span>
                      PROCESSED
                    </span>
                  </div>

                  <div className="meeting-card-meta">
                    <div className="meta-item">
                      <svg
                        className="meta-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect
                          x="3"
                          y="4"
                          width="18"
                          height="18"
                          rx="2"
                          ry="2"
                        ></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                      <span>
                        {formatDateStr(
                          meeting.createdAt || meeting.processedAt,
                        )}
                      </span>
                      <span className="meta-dot">&middot;</span>
                      <svg
                        className="meta-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                      <span>
                        {formatTimeStr(
                          meeting.createdAt || meeting.processedAt,
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="meeting-card-actions">
                    <button
                      className="btn-action btn-insights"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewInsights(meeting.id);
                      }}
                    >
                      Xem chi tiết
                    </button>
                    <button
                      className="btn-action btn-icon-only"
                      title="Share"
                      onClick={(e) => handleShare(meeting.id, e)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                      </svg>
                    </button>
                    <button
                      className="btn-action btn-icon-only btn-delete"
                      title="Delete"
                      onClick={(e) => handleDelete(meeting.id, e)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Add Another Card */}
            <div
              className="meeting-card add-another-card"
              onClick={handleAddAnother}
            >
              <div className="add-another-icon">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </div>
              <span className="add-another-text">Add Another</span>
              <span className="add-another-subtext">
                Click to upload or drag & drop video files here.
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default WorkspacePage;
