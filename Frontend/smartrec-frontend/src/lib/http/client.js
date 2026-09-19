import axios from "axios";

// Lấy từ file env hoặc dùng default
export const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8082/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  withCredentials: true,
  headers: { Accept: "application/json" },
});

export const storageClient = axios.create({
  timeout: 0, // Không timeout để hỗ trợ file lớn
  withCredentials: false,
});
