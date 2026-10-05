import { create } from "zustand";
import { tokenStore } from "../lib/auth/tokenStore.js";

export const useAuthStore = create((set) => {
  tokenStore.subscribe((token) => {
    set({ token, isAuthenticated: Boolean(token) });
  });

  return {
    token: tokenStore.get(),
    isAuthenticated: Boolean(tokenStore.get()),
    setToken: (token) => tokenStore.set(token),
    logout: () => tokenStore.set(null),
  };
});

export const getAccessToken = () => useAuthStore.getState().token;
export const logout = () => useAuthStore.getState().logout();
