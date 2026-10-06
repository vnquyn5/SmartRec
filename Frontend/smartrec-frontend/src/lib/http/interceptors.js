import { api } from "./client.js";
import { tokenStore, refreshTokenStore, authEvents } from "../auth/tokenStore.js";
import { toAppError } from "./errors.js";

// Polyfill uuid for fallback
const uuidv4 = () => {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
    ).toString(16),
  );
};

let refreshPromise = null;
const AUTH_ENDPOINTS = ["/api/auth/login", "/api/auth/register", "/api/auth/google", "/api/auth/refresh-token"];

function isAuthEndpoint(url = "") {
  return AUTH_ENDPOINTS.some((endpoint) => url.includes(endpoint));
}

async function refreshAccessToken() {
  const refreshToken = refreshTokenStore.get();
  if (!refreshToken) throw new Error("Missing refresh token");

  const response = await api.post("/api/auth/refresh-token", { refreshToken }, { skipAuth: true });
  if (!response?.accessToken) throw new Error("Refresh response did not include an access token");
  tokenStore.set(response.accessToken);
  if (response.refreshToken) refreshTokenStore.set(response.refreshToken);
  return response.accessToken;
}

api.interceptors.request.use((config) => {
  if (!config.skipAuth) {
    const token = tokenStore.get();
    if (token) {
      if (!config.headers) config.headers = {};
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const reqId =
    window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : uuidv4();
  if (!config.headers) config.headers = {};
  config.headers["X-Request-Id"] = reqId;

  return config;
});

api.interceptors.response.use(
  (response) => {
    if (response && response.data) {
      return response.data;
    }
    return response;
  },
  async (error) => {
    const config = error.config;
    const status = error.response?.status;

    if (status === 403) authEvents.emit("forbidden");
    if (status === 401 && config && !config.skipAuth && !config._retry && !isAuthEndpoint(config.url)) {
      config._retry = true;
      try {
        let accessToken;
        if (refreshPromise) {
          accessToken = await refreshPromise;
        } else {
          const currentRefresh = refreshAccessToken();
          refreshPromise = currentRefresh;
          try {
            accessToken = await currentRefresh;
          } finally {
            if (refreshPromise === currentRefresh) refreshPromise = null;
          }
        }
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${accessToken}`;
        return api.request(config);
      } catch {
        tokenStore.set(null);
        refreshTokenStore.set(null);
        authEvents.emit("session-expired");
      }
    }

    return Promise.reject(toAppError(error));
  },
);
