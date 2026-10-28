import { api as httpClient } from "../lib/http/client.js";

export async function getFolders(parentId = "all") {
  return httpClient.get(`/folders?parentId=${encodeURIComponent(parentId)}`);
}

export async function createFolder(name, parentId = null) {
  return httpClient.post("/folders", { name, parentId });
}

export async function renameFolder(id, name) {
  return httpClient.patch(`/folders/${id}`, { name });
}

export async function moveMeetingsToFolder(meetingIds, folderId) {
  return httpClient.post("/folders/move", { meetingIds, folderId });
}
