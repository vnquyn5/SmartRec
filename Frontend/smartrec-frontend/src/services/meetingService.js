import { api as httpClient } from "../lib/http/client.js";

const normalizePageResponse = (response) => {
  const content = Array.isArray(response?.content) ? response.content : [];
  const pageNumber = Number(response?.pageNumber ?? response?.page ?? 0);
  const pageSize = Number(response?.pageSize ?? response?.size ?? 10);
  const totalElements = Number(response?.totalElements ?? content.length);
  const totalPages = Number(
    response?.totalPages ??
      (totalElements ? Math.ceil(totalElements / pageSize) : 0),
  );

  return {
    content,
    pageNumber,
    pageSize,
    totalElements,
    totalPages,
    first: response?.first ?? pageNumber === 0,
    last: response?.last ?? (totalPages === 0 || pageNumber >= totalPages - 1),
  };
};

export async function getMeetings({
  page = 0,
  size = 10,
  status = "",
  keyword = "",
} = {}) {
  const response = await httpClient.get("/meetings", {
    params: {
      page,
      size,
      ...(status ? { status } : {}),
      ...(keyword ? { keyword } : {}),
    },
  });
  return normalizePageResponse(response);
}

export async function deleteMeeting(id) {
  return httpClient.delete(`/meetings/${id}`);
}
