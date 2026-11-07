import SockJS from "sockjs-client";
import Stomp from "stompjs/lib/stomp.js";

// Polyfill global for legacy stompjs in modern bundlers if needed
if (typeof window !== "undefined" && typeof window.global === "undefined") {
  window.global = window;
}

/**
 * Lấy WebSocket / SockJS Endpoint từ biến môi trường hoặc fallback tương ứng
 */
export function getWebSocketEndpoint() {
  const envWsUrl = import.meta.env.VITE_WS_URL;
  if (envWsUrl && typeof envWsUrl === "string" && envWsUrl.trim()) {
    return envWsUrl.trim();
  }

  const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:8082/api/v1";
  // Loại bỏ hậu tố /api/v1 nếu có để trỏ tới ws-stomp endpoint của Spring Boot
  const hostRoot = apiBase.replace(/\/api\/v1\/?$/, "");
  return `${hostRoot}/ws-stomp`;
}

/**
 * Factory khởi tạo STOMP Client có bọc SockJS và cấu hình heartbeat
 */
export function createStompClient(endpointUrl = getWebSocketEndpoint()) {
  let socket = null;
  try {
    socket = new SockJS(endpointUrl);
  } catch (err) {
    // Fallback native websocket nếu SockJS gặp sự cố khởi tạo
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const cleanUrl = endpointUrl.replace(/^https?:\/\//i, `${wsProto}//`);
    socket = new WebSocket(cleanUrl);
  }

  const StompLib = Stomp.over ? Stomp : Stomp.default || Stomp;
  const client = StompLib.over(socket);

  // Tắt debug spam trên console trong production
  if (import.meta.env.PROD) {
    client.debug = () => {};
  } else {
    client.debug = (str) => {
      // Có thể bật lại khi cần debug STOMP frames
      // console.debug("[STOMP]", str);
    };
  }

  // Cấu hình Heartbeat STOMP (gửi/nhận mỗi 15 giây)
  client.heartbeat.outgoing = 15000;
  client.heartbeat.incoming = 15000;

  return { client, socket };
}
