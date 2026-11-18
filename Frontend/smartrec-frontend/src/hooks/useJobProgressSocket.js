import { useCallback, useEffect, useRef, useState } from "react";
import { createStompClient } from "../services/websocketService";
import { getJob } from "../services/meetingService";
import {
  JOB_STATUS,
  SOCKET_CONNECTION_STATE,
  isStatusCompleted,
  isStatusFailed,
  normalizeJobPayload,
} from "../types/jobProgress";

const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 1000;
const BACKOFF_MULTIPLIER = 2;

/**
 * Custom Hook quản lý tiến trình WebSocket cho AI Pipeline Job
 * 
 * @param {Object} options
 * @param {string|null} options.jobId - ID của Job đang theo dõi
 * @param {string|null} options.meetingId - ID của Cuộc họp
 * @param {Object|null} options.initialJob - Dữ liệu Job ban đầu (nếu đã có từ cha)
 * @param {boolean} options.enabled - Bật/tắt lắng nghe WebSocket (mặc định: true)
 * @param {Function} [options.onJobCompleted] - Callback khi Job hoàn tất
 * @param {Function} [options.onJobFailed] - Callback khi Job thất bại
 */
export function useJobProgressSocket({
  jobId,
  meetingId,
  initialJob = null,
  enabled = true,
  onJobCompleted,
  onJobFailed,
} = {}) {
  const [jobState, setJobState] = useState(() => {
    if (initialJob) {
      return normalizeJobPayload(initialJob, initialJob?.id);
    }
    return null;
  });

  const [connectionState, setConnectionState] = useState(
    SOCKET_CONNECTION_STATE.DISCONNECTED
  );
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const scheduleReconnectRef = useRef(null);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncError, setSyncError] = useState(null);

  // Refs để lưu trữ trạng thái giữa các lần render và tránh closure cũ
  const stompClientRef = useRef(null);
  const subscriptionRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const activeJobIdRef = useRef(jobId);
  const lastProcessedEventIdRef = useRef(null);
  const isMountedRef = useRef(true);
  const callbacksRef = useRef({ onJobCompleted, onJobFailed });

  useEffect(() => {
    callbacksRef.current = { onJobCompleted, onJobFailed };
  }, [onJobCompleted, onJobFailed]);

  activeJobIdRef.current = jobId;

  /**
   * Cập nhật State một cách an toàn và chống Stale Data
   */
  const applyNormalizedPayload = useCallback((payload, source = "ws") => {
    if (!payload || !isMountedRef.current) return;

    // Guard 1: Kiểm tra Job ID hiện thời
    if (activeJobIdRef.current && payload.jobId && String(payload.jobId) !== String(activeJobIdRef.current)) {
      // Bỏ qua gói tin không thuộc Job hiện tại
      return;
    }

    // Guard 2: Stale check qua eventId hoặc updatedAt
    if (payload.eventId && lastProcessedEventIdRef.current === payload.eventId) {
      // Đã xử lý gói tin này, tránh rerender thừa
      return;
    }

    lastProcessedEventIdRef.current = payload.eventId;

    setJobState((prevState) => {
      // Nếu trước đó đang ở trạng thái hoàn tất mà tin nhắn mới cũ hơn, không hạ cấp
      if (prevState && isStatusCompleted(prevState.status) && !isStatusCompleted(payload.status) && source === "ws") {
        return prevState;
      }
      return payload;
    });

    setLastSyncTime(new Date());

    // Trigger callbacks nếu có
    if (isStatusCompleted(payload.status) && callbacksRef.current.onJobCompleted) {
      callbacksRef.current.onJobCompleted(payload);
    } else if (isStatusFailed(payload.status) && callbacksRef.current.onJobFailed) {
      callbacksRef.current.onJobFailed(payload);
    }
  }, []);

  /**
   * Đồng bộ Snapshot qua REST API: GET /jobs/{jobId}
   * Yêu cầu 2.3: Khi mở lại hoặc reconnect, fetch snapshot hiện tại để tránh mất stage
   */
  const syncSnapshot = useCallback(async (targetJobId = jobId) => {
    if (!targetJobId || !isMountedRef.current) return null;
    try {
      setSyncError(null);
      const res = await getJob(targetJobId);
      const raw = res?.data || res;
      if (raw && isMountedRef.current && String(targetJobId) === String(activeJobIdRef.current)) {
        const normalized = normalizeJobPayload(raw, targetJobId);
        if (normalized) {
          applyNormalizedPayload(normalized, "rest_snapshot");
          return normalized;
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setSyncError(err?.response?.data?.message || err?.message || "Không thể đồng bộ snapshot");
      }
    }
    return null;
  }, [jobId, applyNormalizedPayload]);

  /**
   * Dọn dẹp STOMP subscription và Client
   */
  const cleanupSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (subscriptionRef.current) {
      try {
        subscriptionRef.current.unsubscribe();
      } catch (e) {
        // Ignored
      }
      subscriptionRef.current = null;
    }

    if (stompClientRef.current) {
      try {
        if (stompClientRef.current.connected) {
          stompClientRef.current.disconnect(() => {});
        }
      } catch (e) {
        // Ignored
      }
      stompClientRef.current = null;
    }
  }, []);

  /**
   * Khởi tạo kết nối STOMP & Subscribe Topic
   */
  const connectAndSubscribe = useCallback(() => {
    if (!jobId || !enabled || !isMountedRef.current) return;

    // Dọn dẹp kết nối cũ trước khi tạo kết nối mới
    cleanupSocket();

    setConnectionState(
      reconnectAttemptsRef.current > 0
        ? SOCKET_CONNECTION_STATE.RECONNECTING
        : SOCKET_CONNECTION_STATE.CONNECTING
    );

    try {
      const { client } = createStompClient();
      stompClientRef.current = client;

      const headers = {};
      // Nếu có JWT token trong localStorage/sessionStorage thì truyền vào STOMP header
      const token = localStorage.getItem("accessToken") || localStorage.getItem("token");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      client.connect(
        headers,
        () => {
          // Callback khi STOMP CONNECTED thành công
          if (!isMountedRef.current || String(activeJobIdRef.current) !== String(jobId)) {
            cleanupSocket();
            return;
          }

          setConnectionState(SOCKET_CONNECTION_STATE.CONNECTED);
          reconnectAttemptsRef.current = 0;
          setReconnectAttempts(0);

          // 1. Sau khi kết nối thành công, đồng bộ ngay snapshot để không mất stage (Yêu cầu 2.3)
          syncSnapshot(jobId);

          // 2. Subscribe vào topic của Job
          const destination = `/topic/jobs/${jobId}`;
          try {
            subscriptionRef.current = client.subscribe(destination, (message) => {
              if (!isMountedRef.current) return;
              try {
                const body = JSON.parse(message.body);
                const normalized = normalizeJobPayload(body, jobId);
                if (normalized) {
                  applyNormalizedPayload(normalized, "ws");
                }
              } catch (parseErr) {
                console.error("[useJobProgressSocket] Lỗi parse payload WebSocket:", parseErr);
              }
            });
          } catch (subErr) {
            console.error("[useJobProgressSocket] Lỗi subscribe topic:", subErr);
          }
        },
        (error) => {
          // Callback khi STOMP gặp lỗi hoặc ngắt kết nối
          if (!isMountedRef.current) return;

          setConnectionState(SOCKET_CONNECTION_STATE.DEGRADED);
          scheduleReconnectRef.current?.();
        }
      );
    } catch (connectErr) {
      if (isMountedRef.current) {
        setConnectionState(SOCKET_CONNECTION_STATE.DEGRADED);
        scheduleReconnectRef.current?.();
      }
    }
  }, [jobId, enabled, cleanupSocket, syncSnapshot, applyNormalizedPayload]);

  /**
   * Lên lịch kết nối lại theo Exponential Backoff with Jitter
   */
  const scheduleReconnect = useCallback(() => {
    if (!isMountedRef.current || !enabled || !jobId) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const nextAttempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = nextAttempt;
    setReconnectAttempts(nextAttempt);

    // Exponential backoff: min(MAX, INITIAL * 2^attempts) + random jitter (0-500ms)
    const baseDelay = Math.min(
      MAX_BACKOFF_MS,
      INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, Math.min(nextAttempt, 5))
    );
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;

    reconnectTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        // Trong lúc chờ socket, fallback sync REST snapshot để UI không bị đóng băng
        syncSnapshot(jobId);
        connectAndSubscribe();
      }
    }, delay);
  }, [enabled, jobId, syncSnapshot, connectAndSubscribe]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  /**
   * Hook Lifecycle khi mount / thay đổi jobId
   */
  useEffect(() => {
    isMountedRef.current = true;
    lastProcessedEventIdRef.current = null;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);

    // Khi đổi job, nếu có initialJob thì nạp ngay
    if (initialJob && String(initialJob.id || initialJob.jobId) === String(jobId)) {
      setJobState(normalizeJobPayload(initialJob, jobId));
    } else if (jobId) {
      // Khởi tạo snapshot ngay lập tức
      syncSnapshot(jobId);
    } else {
      setJobState(null);
    }

    if (jobId && enabled) {
      connectAndSubscribe();
    }

    return () => {
      isMountedRef.current = false;
      cleanupSocket();
    };
  }, [jobId, enabled]);

  /**
   * Phương thức mô phỏng sự kiện cho QA/Testing & Dev
   */
  const emitMockEvent = useCallback((mockPayload) => {
    const normalized = normalizeJobPayload({
      jobId: jobId || "mock-job-id",
      ...mockPayload,
      eventId: `mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      updatedAt: new Date().toISOString(),
    }, jobId);
    if (normalized) {
      applyNormalizedPayload(normalized, "mock");
    }
  }, [jobId, applyNormalizedPayload]);

  return {
    jobState,
    connectionState,
    reconnectAttempts,
    lastSyncTime,
    syncError,
    syncSnapshot,
    emitMockEvent,
    isConnected: connectionState === SOCKET_CONNECTION_STATE.CONNECTED,
    isDegraded: connectionState === SOCKET_CONNECTION_STATE.DEGRADED || connectionState === SOCKET_CONNECTION_STATE.RECONNECTING,
    isOffline: connectionState === SOCKET_CONNECTION_STATE.OFFLINE || connectionState === SOCKET_CONNECTION_STATE.DISCONNECTED,
  };
}
