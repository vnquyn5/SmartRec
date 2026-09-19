import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { api } from "../../lib/http/client.js";
import { tokenStore, authEvents } from "../../lib/auth/tokenStore.js";

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

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("bootstrapping");
  const [user, setUser] = useState(null);
  const [registeredUser, setRegisteredUser] = useState(null);

  const clearSession = useCallback(() => {
    tokenStore.set(null);
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
      if (tokenStore.get() && storedUser) {
        setUser(storedUser);
        setStatus("authenticated");
      } else {
        clearSession();
      }
    })();
    return () => {
      alive = false;
    };
  }, [clearSession]);

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

  const login = useCallback(async (email, password) => {
    const response = await api.post(
      "/api/auth/login",
      {
        email,
        passWord: password,
      },
      { skipAuth: true },
    );
    const nextUser = {
      id: response.userId,
      name: response.fullName,
      email: response.email,
      roles: [],
    };
    tokenStore.set(response.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setStatus("authenticated");
    channel?.postMessage({ type: "login" });
  }, []);

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
      register,
      logout,
      hasRole: (role) => !!user?.roles?.includes(role),
    }),
    [status, user, registeredUser, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải được dùng bên trong AuthProvider");
  return ctx;
}
