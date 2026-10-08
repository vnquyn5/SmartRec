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

export async function getAllMeetings() {
  const firstPage = await getMeetings({ page: 0, size: 100 });
  if (firstPage.totalPages <= 1) return firstPage;

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
      getMeetings({ page: index + 1, size: 100 }),
    ),
  );

  return {
    ...firstPage,
    content: [
      ...firstPage.content,
      ...remainingPages.flatMap((page) => page.content),
    ],
  };
}

export async function deleteMeeting(id) {
  return httpClient.delete(`/meetings/${id}`);
}

export async function getMeetingPlaybackUrl(id, signal) {
  return httpClient.get(`/meetings/${id}/playback-url`, { signal });
}

export async function downloadMeeting(id) {
  return httpClient.get(`/meetings/${id}/download`, {
    responseType: "blob",
    timeout: 0,
  });
}

export async function downloadMeetings(ids) {
  return httpClient.post("/meetings/download", ids, {
    responseType: "blob",
    timeout: 0,
  });
}

export async function renameMeeting(id, fileName) {
  return httpClient.patch(`/meetings/${id}/name`, { fileName });
}

export async function startMeetingProcessing(id) {
  return httpClient.post(`/meetings/${id}/process`);
}

export async function getJob(id) {
  return httpClient.get(`/jobs/${id}`);
}

export async function pauseJob(id) {
  return httpClient.post(`/jobs/${id}/pause`);
}

export async function resumeJob(id) {
  return httpClient.post(`/jobs/${id}/resume`);
}

export async function cancelJob(id) {
  return httpClient.post(`/jobs/${id}/cancel`);
}

export async function retryJob(id) {
  return httpClient.post(`/jobs/${id}/retry`);
}
