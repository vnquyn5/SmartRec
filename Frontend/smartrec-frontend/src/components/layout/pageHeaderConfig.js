const PAGE_HEADERS = {
  "/upload": {
    title: "Tải lên cuộc họp",
    subtitle: "Thêm tệp để AI phân tích, tổng hợp và tạo bản ghi cuộc họp.",
  },
  "/history": {
    title: "Danh sách cuộc họp",
    subtitle: "Xem danh sách các file cuộc họp đã tải lên trong không gian cá nhân.",
  },
  "/trash": {
    title: "Thùng rác",
    subtitle: "Các tệp sẽ tự động bị xóa vĩnh viễn sau 30 ngày.",
  },
  "/profile": {
    title: "Cài đặt",
    subtitle: "Quản lý thông tin cá nhân, bảo mật và vai trò.",
  },
};

export function getPageHeader(pathname) {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const exactMatch = PAGE_HEADERS[normalizedPath];
  if (exactMatch) return exactMatch;

  if (/^\/meeting\/[^/]+$/.test(normalizedPath)) {
    return {
      title: "Đang tải cuộc họp…",
      subtitle: "Đang tải thông tin cuộc họp.",
    };
  }

  return { title: "", subtitle: "" };
}
