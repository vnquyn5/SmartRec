const TOKEN_KEY = "smartrec_access_token";
let accessToken = sessionStorage.getItem(TOKEN_KEY);
const listeners = new Set();

function readClaims(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")));
  } catch {
    return null;
  }
}

export const tokenStore = {
  get() {
    return accessToken;
  },
  set(token) {
    accessToken = token;
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
    listeners.forEach((fn) => fn(token));
  },
  getExpiration() {
    return readClaims(accessToken)?.exp ?? null;
  },
  isExpired() {
    const expiration = this.getExpiration();
    return !expiration || expiration * 1000 <= Date.now();
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
