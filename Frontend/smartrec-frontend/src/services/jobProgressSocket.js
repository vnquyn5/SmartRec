import StompModule from "stompjs/lib/stomp.js";
import { tokenStore } from "../lib/auth/tokenStore.js";
import { getReconnectDelay } from "./jobProgressState.js";

const API_BASE = import.meta.env?.VITE_API_BASE_URL || "http://localhost:8082/api/v1";
const subscriptions = new Map();
const Stomp = StompModule.Stomp ?? StompModule;
let client = null;
let connected = false;
let retryTimer = null;
let retryAttempt = 0;
let connectionGeneration = 0;

function websocketUrl() {
  const url = new URL(API_BASE, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function notifyConnectionListeners(isConnected) {
  subscriptions.forEach((entry) => {
    entry.listeners.forEach((listener) => listener.onConnection?.(isConnected));
  });
}

function disconnectClient() {
  connectionGeneration += 1;
  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = null;
  connected = false;
  const current = client;
  client = null;
  if (current?.connected) current.disconnect(() => {});
  notifyConnectionListeners(false);
}

function scheduleReconnect() {
  if (retryTimer || subscriptions.size === 0 || !tokenStore.get()) return;
  const delay = getReconnectDelay(retryAttempt);
  retryAttempt += 1;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (connected || client || subscriptions.size === 0 || !tokenStore.get()) return;
  const generation = ++connectionGeneration;
  const current = Stomp.client(websocketUrl());
  current.debug = () => {};
  client = current;
  const token = tokenStore.get();

  const failed = () => {
    if (generation !== connectionGeneration) return;
    client = null;
    connected = false;
    notifyConnectionListeners(false);
    scheduleReconnect();
  };

  current.connect(
    { Authorization: `Bearer ${token}` },
    () => {
      if (generation !== connectionGeneration) {
        current.disconnect(() => {});
        return;
      }
      connected = true;
      retryAttempt = 0;
      subscriptions.forEach((entry, jobId) => {
        entry.subscription = current.subscribe(
          `/topic/jobs/${jobId}`,
          (frame) => {
            try {
              const event = JSON.parse(frame.body);
              entry.listeners.forEach((listener) => listener.onEvent(event));
            } catch {
              // Ignore malformed broker payloads; REST snapshots remain authoritative.
            }
          },
        );
      });
      notifyConnectionListeners(true);
    },
    failed,
  );
}

tokenStore.subscribe(() => {
  disconnectClient();
  connect();
});

export function subscribeToJobProgress(jobId, onEvent, onConnection) {
  if (!jobId || typeof onEvent !== "function") return () => {};
  let entry = subscriptions.get(jobId);
  if (!entry) {
    entry = { listeners: new Set(), subscription: null };
    subscriptions.set(jobId, entry);
  }
  const listener = { onEvent, onConnection };
  entry.listeners.add(listener);
  const wasConnected = connected;
  connect();
  if (wasConnected && entry.subscription) onConnection?.(true);

  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.subscription?.unsubscribe();
      subscriptions.delete(jobId);
    }
    if (subscriptions.size === 0) {
      disconnectClient();
      retryAttempt = 0;
    }
  };
}
