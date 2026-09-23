import React, { useState, useRef, DragEvent, ChangeEvent } from "react";
import { sliceFileToBlobs, formatBytes, FileChunk } from "../../utils/fileSlice";
import { useChunkQueue } from "../../hooks/useChunkQueue";

const ALLOWED_EXTENSIONS = [".mp3", ".mp4", ".mkv"];
const ALLOWED_MIME_TYPES = ["audio/mpeg", "video/mp4", "video/x-matroska"];

interface LargeFileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LargeFileUploadModal: React.FC<LargeFileUploadModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [chunks, setChunks] = useState<FileChunk[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { progress, isUploading, uploadedChunks, startUpload, cancelUpload } =
    useChunkQueue();

  if (!isOpen) return null;

  // Kiểm tra tính hợp lệ của File
  const validateAndProcessFile = (file: File) => {
    setErrorMessage("");

    // Validation Rule: Tên file tối đa 255 ký tự
    if (file.name.length > 255) {
      setErrorMessage("Tên file vượt quá 255 ký tự cho phép!");
      return;
    }

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    const isValidExtension = ALLOWED_EXTENSIONS.includes(ext);
    const isValidMime = ALLOWED_MIME_TYPES.includes(file.type);

    if (!isValidExtension && !isValidMime) {
      setErrorMessage("Chỉ chấp nhận định dạng .mp3, .mp4, .mkv");
      return;
    }

    setSelectedFile(file);
    // Cắt nhỏ file ngay lập tức (thao tác zero-copy, không nghẽn luồng)
    const generatedChunks = sliceFileToBlobs(file);
    setChunks(generatedChunks);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (e.dataTransfer.files.length > 1) {
        setErrorMessage("Vui lòng chỉ tải lên duy nhất 1 file!");
        return;
      }
      validateAndProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndProcessFile(e.target.files[0]);
    }
  };

  const handleReset = () => {
    cancelUpload();
    setSelectedFile(null);
    setChunks([]);
    setErrorMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  // Đọc Blob chunk thành ArrayBuffer bằng FileReader (TR09: HTML5 FileReader API)
  // An toàn vì mỗi chunk chỉ 5MB, không đọc toàn bộ file lớn vào RAM
  const readChunkAsArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error("FileReader: Lỗi đọc chunk"));
      reader.readAsArrayBuffer(blob);
    });
  };

  // Gửi từng chunk lên server (thay bằng axios/fetch endpoint thực tế)
  const mockUploadChunkApi = async (chunk: FileChunk, signal: AbortSignal) => {
    // Bước 1: Đọc blob chunk thành ArrayBuffer qua FileReader
    const buffer = await readChunkAsArrayBuffer(chunk.blob);

    // Bước 2: Tạo Blob mới từ buffer để đính kèm vào FormData
    const formData = new FormData();
    formData.append("chunk", new Blob([buffer]), `chunk_${chunk.index}`);
    formData.append("index", chunk.index.toString());

    // Giả lập delay mạng ngẫu nhiên từ 100ms - 300ms
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 150);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Upload aborted"));
      });
    });
  };

  const handleStartUpload = () => {
    if (!selectedFile || chunks.length === 0) return;

    startUpload({
      chunks,
      concurrency: 3,
      uploadChunkFn: mockUploadChunkApi,
      onSuccess: () => {
        alert("Tải lên file thành công!");
        handleClose();
      },
      onError: (err) => {
        setErrorMessage(`Lỗi truyền tải: ${err.message}`);
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <h2 className="text-xl font-bold text-white">
            Tải lên File Dung Lượng Lớn
          </h2>
          <button
            onClick={handleClose}
            className="text-slate-500 hover:text-slate-300 font-semibold text-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Dropzone Area */}
        {!selectedFile ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? "border-blue-500 bg-blue-500/10"
                : "border-slate-700 hover:border-blue-400 bg-slate-800/30"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.mp4,.mkv,audio/mpeg,video/mp4,video/x-matroska"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="p-3 bg-blue-500/10 text-blue-500 rounded-full mb-3">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="font-medium text-slate-200">
              Kéo thả file video/audio vào đây hoặc nhấp để chọn file
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Hỗ trợ định dạng: .mp3, .mp4, .mkv (Tối đa 5GB+)
            </p>
          </div>
        ) : (
          /* File Detail Panel */
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase text-slate-400">
                  Thông tin tập tin
                </span>
                <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-medium">
                  {chunks.length} Chunks (5MB/chunk)
                </span>
              </div>
              <p className="text-sm font-semibold text-slate-200 truncate" title={selectedFile.name}>
                Tên file: {selectedFile.name}
              </p>
              <p className="text-sm text-slate-400 mt-1">
                Kích thước: {formatBytes(selectedFile.size)}
              </p>
            </div>

            {/* Thanh tiến độ Upload */}
            {isUploading && (
              <div className="space-y-3">
                <div className="flex justify-between text-xs font-semibold text-slate-400">
                  <span>Tiến độ: {progress}%</span>
                  <span>
                    {uploadedChunks} / {chunks.length} Chunks (3 Workers)
                  </span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Queue Status — Trạng thái hàng đợi trực quan */}
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {/* Đang chờ trong Queue */}
                  <div className="rounded-lg bg-slate-800 border border-slate-700 p-3 text-center">
                    <div className="text-lg font-bold text-amber-400">
                      {chunks.length - uploadedChunks - Math.min(3, chunks.length - uploadedChunks)}
                    </div>
                    <div className="text-[10px] uppercase font-semibold text-slate-500 mt-1 tracking-wider">
                      Đang chờ
                    </div>
                    <div className="flex justify-center gap-0.5 mt-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500/40"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500/40"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500/40"></span>
                    </div>
                  </div>

                  {/* Đang tải — 3 Workers */}
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-center">
                    <div className="text-lg font-bold text-blue-400">
                      {Math.min(3, chunks.length - uploadedChunks)}
                    </div>
                    <div className="text-[10px] uppercase font-semibold text-slate-500 mt-1 tracking-wider">
                      Đang tải
                    </div>
                    <div className="flex justify-center gap-0.5 mt-1.5">
                      {[0, 1, 2].map(i => (
                        <span key={i} className={`w-1.5 h-1.5 rounded-full ${
                          i < Math.min(3, chunks.length - uploadedChunks)
                            ? "bg-blue-400 animate-pulse"
                            : "bg-slate-600"
                        }`}></span>
                      ))}
                    </div>
                  </div>

                  {/* Hoàn thành */}
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                    <div className="text-lg font-bold text-emerald-400">
                      {uploadedChunks}
                    </div>
                    <div className="text-[10px] uppercase font-semibold text-slate-500 mt-1 tracking-wider">
                      Hoàn thành
                    </div>
                    <div className="flex justify-center gap-0.5 mt-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Thông báo lỗi */}
        {errorMessage && (
          <div className="mt-3 p-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
            {errorMessage}
          </div>
        )}

        {/* Buttons / Actions */}
        <div className="flex justify-end space-x-3 mt-6 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-lg transition"
          >
            Hủy
          </button>

          {selectedFile && !isUploading && (
            <button
              type="button"
              onClick={handleStartUpload}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm transition"
            >
              Tải lên ngay
            </button>
          )}

          {isUploading && (
            <button
              type="button"
              onClick={cancelUpload}
              className="px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 rounded-lg transition"
            >
              Dừng tải
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LargeFileUploadModal;

