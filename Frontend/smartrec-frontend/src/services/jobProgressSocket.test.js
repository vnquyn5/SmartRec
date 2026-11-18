import assert from "node:assert/strict";
import test from "node:test";

const timers = new Map();
let nextTimerId = 1;
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.window = {
  location: { origin: "http://localhost:5173" },
  setTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
};

const { tokenStore } = await import("../lib/auth/tokenStore.js");
tokenStore.set("test-user-jwt");
const stompModule = await import("stompjs/lib/stomp.js");
const stomp = stompModule.Stomp;
const clients = [];
let failNextConnect = false;
stomp.client = (url) => {
  const client = {
    url,
    connected: false,
    subscriptions: new Map(),
    connect(headers, onConnect, onError) {
      this.headers = headers;
      if (failNextConnect) {
        failNextConnect = false;
        onError(new Error("offline"));
        return;
      }
      this.connected = true;
      onConnect();
    },
    subscribe(destination, callback) {
      this.subscriptions.set(destination, callback);
      return {
        unsubscribe: () => this.subscriptions.delete(destination),
      };
    },
    disconnect(onDisconnect) {
      this.connected = false;
      onDisconnect?.();
    },
  };
  clients.push(client);
  return client;
};

const { subscribeToJobProgress } = await import("./jobProgressSocket.js");

test("shares an authenticated connection, dispatches events, unsubscribes, and reconnects", () => {
  const received = [];
  const states = [];
  const removeA = subscribeToJobProgress("job-a", (event) => received.push(event), (state) => states.push(state));
  const removeB = subscribeToJobProgress("job-a", (event) => received.push(event));

  assert.equal(clients.length, 1);
  assert.equal(clients[0].url, "ws://localhost:8082/api/v1/ws");
  assert.deepEqual(clients[0].headers, { Authorization: "Bearer test-user-jwt" });
  assert.equal(clients[0].subscriptions.size, 1);
  clients[0].subscriptions.get("/topic/jobs/job-a")({
    body: JSON.stringify({ jobId: "job-a", sequence: 1 }),
  });
  assert.equal(received.length, 2);
  assert.deepEqual(states, [true]);

  removeA();
  assert.equal(clients[0].subscriptions.size, 1);
  removeB();
  assert.equal(clients[0].subscriptions.size, 0);
  assert.equal(clients[0].connected, false);

  failNextConnect = true;
  const reconnectStates = [];
  const unsubscribe = subscribeToJobProgress("job-b", () => {}, (state) => reconnectStates.push(state));
  assert.equal(clients.length, 2);
  assert.deepEqual(reconnectStates, [false]);
  const [timerId, timer] = [...timers.entries()][0];
  assert.ok(timer.delay >= 400 && timer.delay <= 600);

  timers.delete(timerId);
  timer.callback();
  assert.equal(clients.length, 3);
  assert.equal(clients[2].subscriptions.has("/topic/jobs/job-b"), true);
  assert.deepEqual(reconnectStates, [false, true]);
  unsubscribe();
});
