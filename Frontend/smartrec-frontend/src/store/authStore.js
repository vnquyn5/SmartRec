import { create } from 'zustand';

const TOKEN_KEY = 'token';

export const useAuthStore = create((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  isAuthenticated: Boolean(localStorage.getItem(TOKEN_KEY)),
  setToken: (token) => {
    localStorage.setItem(TOKEN_KEY, token);
    set({ token, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, isAuthenticated: false });
  },
}));

export const getAccessToken = () => useAuthStore.getState().token;
export const logout = () => useAuthStore.getState().logout();
