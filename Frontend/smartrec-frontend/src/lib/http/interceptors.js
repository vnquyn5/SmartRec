import { api } from './client.js';
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

api.interceptors.response.use(
  (response) => {
      if (response && response.data) {
          return response.data; 
      }
      return response;
  },
  (error) => {
    const config = error.config;
    const status = error.response?.status;

    if (status === 403) authEvents.emit('forbidden');
    if (status === 401 && !config?.skipAuth) {
      tokenStore.set(null);
      authEvents.emit('session-expired');
    }

    return Promise.reject(toAppError(error));
  }
);
