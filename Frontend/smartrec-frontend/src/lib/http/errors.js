import axios from "axios";

export function toAppError(err) {
  if (axios.isCancel(err)) {
    return { kind: "canceled", message: "Yêu cầu đã bị huỷ.", cause: err };
  }
  if (axios.isAxiosError(err)) {
    const e = err;
    if (e.code === "ECONNABORTED") {
      return {
        kind: "timeout",
        message: "Yêu cầu quá thời gian chờ.",
        cause: err,
      };
    }
    if (!e.response) {
      return {
        kind: "network",
        message: "Không kết nối được tới máy chủ.",
        cause: err,
      };
    }
    return {
      kind: "http",
      status: e.response.status,
      code: e.response.data?.code,
      message: e.response.data?.message ?? "Đã có lỗi xảy ra.",
      detail: e.response.data?.detail,
      requestId: e.config?.headers?.["X-Request-Id"],
      cause: err,
    };
  }
  return { kind: "unknown", message: "Đã có lỗi không xác định.", cause: err };
}
