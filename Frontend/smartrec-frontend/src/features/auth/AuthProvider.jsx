import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../../lib/http/client.js';
import { tokenStore, authEvents } from '../../lib/auth/tokenStore.js';

// Tạm thời hủy bỏ (comment lại) việc tích hợp Axios Interceptor theo yêu cầu
// import '../../lib/http/interceptors.js';

const AuthContext = createContext(null);

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('auth') : null;

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('bootstrapping');
  const [user, setUser] = useState(null);

  const clearSession = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // 1. Bootstrap: Khởi tạo trạng thái ban đầu khi vừa chạy app
  useEffect(() => {
    let alive = true;
    (async () => {
      // Giả lập thời gian load trang (để thấy spinner)
      await new Promise(r => setTimeout(r, 500));
      if (!alive) return;
      
      // Khởi tạo app ở trạng thái "Chưa đăng nhập" (thay vì tự động login như trước)
      setStatus('unauthenticated');
    })();
    return () => { alive = false; };
  }, [clearSession]);

  // 2. Lắng nghe sự kiện hết phiên phát ra từ tầng HTTP.
  useEffect(() => authEvents.on((e) => {
    if (e === 'session-expired') {
      clearSession();
      channel?.postMessage({ type: 'logout' });
    }
  }), [clearSession]);

  // 3. Đồng bộ đa tab.
  useEffect(() => {
    if (!channel) return;
    const onMessage = (ev) => {
      if (ev.data?.type === 'logout') clearSession();
    };
    channel.addEventListener('message', onMessage);
    return () => channel.removeEventListener('message', onMessage);
  }, [clearSession]);

  const login = useCallback(async (email, password) => {
    // MOCK LOGIN
    await new Promise(r => setTimeout(r, 1000));
    tokenStore.set("mock-jwt-token");
    setUser({ id: 1, name: "Demo User", email, roles: ["USER"] });
    setStatus('authenticated');
    channel?.postMessage({ type: 'login' });
  }, []);

  const logout = useCallback(async () => {
    try { 
      await api.post('/auth/logout'); 
    } finally {
      clearSession();
      channel?.postMessage({ type: 'logout' });
    }
  }, [clearSession]);

  const value = useMemo(() => ({
    status, 
    user, 
    login, 
    logout,
    hasRole: (role) => !!user?.roles?.includes(role),
  }), [status, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải được dùng bên trong AuthProvider');
  return ctx;
}
