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
    last:
      response?.last ?? (totalPages === 0 || pageNumber >= totalPages - 1),
  };
};

export async function getTrashFiles({ page = 0, size = 10, keyword = "" } = {}) {
  const response = await httpClient.get("/media/trash", {
    params: {
      page,
      size,
      ...(keyword ? { keyword } : {}),
    },
  });
  return normalizePageResponse(response);
}

export async function softDeleteMediaFile(mediaFileId) {
  return httpClient.delete(`/media/${mediaFileId}`);
}

export async function restoreMediaFile(mediaFileId) {
  return httpClient.post(`/media/${mediaFileId}/restore`);
}

export async function permanentDeleteMediaFile(mediaFileId) {
  return httpClient.delete(`/media/${mediaFileId}/permanent`);
}
