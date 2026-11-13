export function getUploadActionButtonState({
  preparedCount = 0,
  arePreparedNamesValid = false,
  isStartingUploads = false,
  hasUploadInProgress = false,
  pendingChunkCount = 0,
} = {}) {
  const isLoading =
    isStartingUploads || hasUploadInProgress || pendingChunkCount > 0;

  return {
    label: isLoading ? "Đang tải lên..." : "Bắt đầu tải lên",
    loading: isLoading,
    disabled:
      isLoading || preparedCount === 0 || !arePreparedNamesValid,
  };
}
