import axios from 'axios';
import { api, API_BASE } from './client.js';
import { tokenStore, authEvents } from '../auth/tokenStore.js';
import { toAppError } from './errors.js';

// Polyfill uuid for fallback
const uuidv4 = () => {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
};

api.interceptors.request.use((config) => {
  if (!config.skipAuth) {
    const token = tokenStore.get();
    if (token) {
      if (!config.headers) config.headers = {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  
  const reqId = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : uuidv4();
  if (!config.headers) config.headers = {};
  config.headers['X-Request-Id'] = reqId;
  
  return config;
});

let refreshPromise = null;

async function requestNewToken() {
  const { data } = await axios.post(
    `${API_BASE}/auth/refresh`,
    null,
    { withCredentials: true, timeout: 15000 }
  );
  return data.accessToken;
}

function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = requestNewToken()
      .then((token) => { tokenStore.set(token); return token; })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

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

    // Handle payload too large
    if (status === 413) {
      alert("Lỗi: Kích thước file vượt quá giới hạn cho phép.");
      return Promise.reject(toAppError(error));
    }

    // Handle network errors or timeout globally
    if (!error.response && error.code === 'ECONNABORTED') {
      alert("Lỗi: Kết nối quá hạn (Timeout).");
    } else if (!error.response) {
      alert("Lỗi: Không thể kết nối tới máy chủ (Connection Refused).");
    }

    const shouldRefresh =
      status === 401 &&
      !!config &&
      !config._retry &&
      !config.skipAuth;

    if (!shouldRefresh) {
      if (status === 403) authEvents.emit('forbidden');
      // Token expiration during refresh or general 401 without refresh means session expired
      if (status === 401) {
        alert("Phiên làm việc hết hạn");
        tokenStore.set(null);
        authEvents.emit('session-expired');
      }
      return Promise.reject(toAppError(error));
    }

    config._retry = true;

    try {
      const token = await refreshOnce();
      if (!config.headers) config.headers = {};
      config.headers['Authorization'] = `Bearer ${token}`;
      return api(config);
    } catch {
      alert("Phiên làm việc hết hạn");
      tokenStore.set(null);
      authEvents.emit('session-expired');
      return Promise.reject(toAppError(error));
    }
  }
);
