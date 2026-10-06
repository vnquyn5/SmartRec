import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { api } from "../../lib/http/client.js";
import { tokenStore, refreshTokenStore, authEvents } from "../../lib/auth/tokenStore.js";

import "../../lib/http/interceptors.js";

const AuthContext = createContext(null);

const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("auth") : null;
const USER_KEY = "smartrec_user";

function readStoredUser() {
  try {
    const value = localStorage.getItem(USER_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function getExpirationDelay() {
  const expiration = tokenStore.getExpiration();
  return expiration ? Math.max(0, expiration * 1000 - Date.now()) : 0;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("bootstrapping");
  const [user, setUser] = useState(null);
  const [registeredUser, setRegisteredUser] = useState(null);

  const clearSession = useCallback(() => {
    tokenStore.set(null);
    refreshTokenStore.set(null);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  // 1. Bootstrap: Khởi tạo trạng thái ban đầu khi vừa chạy app
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;

      const storedUser = readStoredUser();
      if (tokenStore.get() && !tokenStore.isExpired() && storedUser) {
        setUser(storedUser);
        setStatus("authenticated");

        try {
          const profile = await api.get("/api/user/me");
          if (!alive) return;

          const currentUser = {
            ...storedUser,
            id: profile.id ?? storedUser.id,
            userCode: profile.userCode ?? storedUser.userCode,
            name: profile.full_name ?? storedUser.name,
            email: profile.email ?? storedUser.email,
            phone: profile.phone ?? storedUser.phone,
            department: profile.department ?? storedUser.department,
            position: profile.position ?? storedUser.position,
            role: profile.role ?? storedUser.role,
            roles: profile.role ? [profile.role] : storedUser.roles,
          };
          setUser(currentUser);
          localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
        } catch {
          if (alive) setUser(storedUser);
        }
      } else {
        clearSession();
      }
    })();
    return () => {
      alive = false;
    };
  }, [clearSession]);

  const [tokenRevision, setTokenRevision] = useState(0);
  useEffect(() => tokenStore.subscribe(() => setTokenRevision((revision) => revision + 1)), []);

  useEffect(() => {
    if (status !== "authenticated" || !tokenStore.get()) return undefined;
    const delay = getExpirationDelay();
    if (!delay) return undefined; // Request interceptor refreshes expired access tokens on demand.
    const timeoutId = window.setTimeout(() => {
      if (!refreshTokenStore.get()) authEvents.emit("session-expired");
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [status, user, tokenRevision]);

  // 2. Lắng nghe sự kiện hết phiên phát ra từ tầng HTTP.
  useEffect(
    () =>
      authEvents.on((e) => {
        if (e === "session-expired") {
          clearSession();
          channel?.postMessage({ type: "logout" });
        }
      }),
    [clearSession],
  );

  // 3. Đồng bộ đa tab.
  useEffect(() => {
    if (!channel) return;
    const onMessage = (ev) => {
      if (ev.data?.type === "logout") clearSession();
    };
    channel.addEventListener("message", onMessage);
    return () => channel.removeEventListener("message", onMessage);
  }, [clearSession]);

  const completeAuthentication = useCallback((response, fallbackUser) => {
    if (!response?.accessToken) throw new Error("Máy chủ không trả về access token hợp lệ.");
    const responseUser = response.user;
    const nextUser = responseUser
      ? {
          id: responseUser.id,
          name: responseUser.fullName ?? responseUser.full_name ?? responseUser.name ?? "",
          email: responseUser.email ?? "",
          avatarUrl: responseUser.avatarUrl ?? responseUser.avatar_url ?? null,
          roles: responseUser.roles ?? (responseUser.role ? [responseUser.role] : []),
        }
      : fallbackUser;
    if (!nextUser) throw new Error("Máy chủ không trả về thông tin người dùng.");

    tokenStore.set(response.accessToken);
    refreshTokenStore.set(response.refreshToken ?? null);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setStatus("authenticated");
    channel?.postMessage({ type: "login" });
    return nextUser;
  }, []);

  const login = useCallback(async (email, password) => {
    const response = await api.post(
      "/api/auth/login",
      {
        email,
        passWord: password,
      },
      { skipAuth: true },
    );
    const fallbackUser = {
      id: response.userId,
      name: response.fullName,
      email: response.email,
      roles: [],
    };
    return completeAuthentication(response, fallbackUser);
  }, [completeAuthentication]);

  const googleLogin = useCallback(async (idToken) => {
    const response = await api.post("/api/auth/google", { idToken }, { skipAuth: true });
    completeAuthentication(response);
  }, [completeAuthentication]);

  const register = useCallback(async (profile) => {
    await api.post(
      "/api/auth/register",
      {
        email: profile.email,
        phone: profile.phone,
        passWord: profile.password,
        full_name: profile.fullName,
      },
      { skipAuth: true },
    );
    setRegisteredUser({ name: profile.fullName, email: profile.email });
    return true;
  }, []);

  const logout = useCallback(async () => {
    clearSession();
    channel?.postMessage({ type: "logout" });
  }, [clearSession]);

  const value = useMemo(
    () => ({
      status,
      user,
      registeredUser,
      login,
      googleLogin,
      register,
      logout,
      hasRole: (role) => !!user?.roles?.includes(role),
    }),
    [status, user, registeredUser, login, googleLogin, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải được dùng bên trong AuthProvider");
  return ctx;
}
