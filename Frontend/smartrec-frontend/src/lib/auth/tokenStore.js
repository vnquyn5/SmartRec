let accessToken = null;
const listeners = new Set();

export const tokenStore = {
  get() {
    return accessToken;
  },
  set(token) {
    accessToken = token;
    listeners.forEach((fn) => fn(token));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

const authListeners = new Set();

export const authEvents = {
  emit(e) {
    authListeners.forEach((fn) => fn(e));
  },
  on(fn) {
    authListeners.add(fn);
    return () => {
      authListeners.delete(fn);
    };
  },
};
