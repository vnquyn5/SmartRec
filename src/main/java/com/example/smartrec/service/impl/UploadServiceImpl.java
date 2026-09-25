package com.example.smartrec.service.impl;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.enums.UploadSessionStatus;

import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.UploadSession;
import com.example.smartrec.model.dto.ChunkUploadRequest;
import com.example.smartrec.model.dto.ChunkUploadResponse;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.UploadService;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class UploadServiceImpl implements UploadService {
        private final UserRepository userRepository;
        private final UploadSessionRedisService uploadSessionRedisService;
        private final MinioService minioService;

        // chunk =5 MB
        private static final long CHUNK_SIZE = 5l * 1024 * 1024;

        private static final Set<String> ALLOWED_EXTENSIONS = Set.of("mp3", "mp4", "m4a", "mkv");

        @Override
        public UploadInitResponse initUpload(UploadInitRequest request) {
                if (request == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "Upload request không được null");
                }
                User user = getCurrentUser();
                String fileName = request.getFileName();
                if (fileName == null || fileName.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "ERR_INVALID_FILENAME",
                                        "Tên file không được để trống");
                }
                fileName = fileName.trim();

                String extension = getExtension(fileName);
                if (!ALLOWED_EXTENSIONS.contains(extension)) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "ERR_INVALID_FILE_TYPE",
                                        "Chỉ hỗ trợ file .mp4, .mkv, .mp3, .m4a");
                }

                Long fileSize = request.getFileSize();
                if (fileSize == null || fileSize <= 0) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "ERR_INVALID_FILE_SIZE",
                                        "File size phải lớn hơn 0");
                }
                Integer totalChunks = request.getTotalChunks();
                if (totalChunks == null || totalChunks <= 0) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "ERR_INVALID_TOTAL_CHUNKS",
                                        "Total chunks phải lớn hơn 0");
                }

                // Tạo UUID cho upload session
                UUID uploadSessionId = UUID.randomUUID();

                // 8. Tạo UploadSession
                UploadSession session = UploadSession.builder()
                                .uploadSessionId(uploadSessionId)
                                .userId(user.getId())
                                .fileName(fileName)
                                .fileSize(fileSize)
                                .totalChunks(totalChunks)
                                .chunkSize(CHUNK_SIZE)
                                .receivedChunks(0)
                                .status(UploadSessionStatus.INITIATED)
                                .build();

                // luu upload session vao redis
                uploadSessionRedisService.save(session);
                return UploadInitResponse.builder()
                                .uploadSessionId(uploadSessionId.toString())
                                .chunkSize(CHUNK_SIZE)
                                .totalChunks(totalChunks)
                                .status(UploadSessionStatus.INITIATED.name())
                                .build();

        }

        private User getCurrentUser() {

                Authentication authentication = SecurityContextHolder
                                .getContext()
                                .getAuthentication();

                if (authentication == null
                                || !authentication.isAuthenticated()) {

                        throw new BusinessException(
                                        HttpStatus.UNAUTHORIZED,
                                        "UNAUTHORIZED",
                                        "Yêu cầu đăng nhập");
                }

                String identifier = authentication.getName();

                return userRepository.findByEmail(identifier)
                                .or(() -> userRepository.findByPhone(identifier))
                                .orElseThrow(() -> new BusinessException(
                                                HttpStatus.UNAUTHORIZED,
                                                "USER_NOT_FOUND",
                                                "Không tìm thấy người dùng đăng nhập"));
        }

        private String getExtension(String fileName) {

                int lastDot = fileName.lastIndexOf('.');

                if (lastDot == -1 || lastDot == fileName.length() - 1) {
                        return "";
                }

                return fileName
                                .substring(lastDot + 1)
                                .toLowerCase();
        }

        @Override
        public ChunkUploadResponse uploadChunk(ChunkUploadRequest request) {
                if (request == null) {
                        throw new BusinessException(HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "Chunk upload request không được null");
                }
                String sessionIdString = request.getUploadSessionId();
                if (sessionIdString == null || sessionIdString.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "Upload session ID không được để trống");
                }
                UUID uploadSessionId;
                try {
                        uploadSessionId = UUID.fromString(sessionIdString);                    
                } catch (IllegalArgumentException  e) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "Upload session ID không hợp lệ");
                }
                User crusUser=getCurrentUser();
                UploadSession session = uploadSessionRedisService.get(uploadSessionId);

                if(!session.getUserId().equals(crusUser.getId())){
                        throw new BusinessException(
                                        HttpStatus.FORBIDDEN,
                                        "UPLOAD_SESSION_NOT_OWNED",
                                        "Upload session không thuộc người dùng hiện tại");
                }

                if(session.getStatus() != UploadSessionStatus.INITIATED  && session.getStatus() != UploadSessionStatus.UPLOADING){
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "INVALID_UPLOAD_SESSION_STATUS",
                                        "Upload session không ở trạng thái cho phép upload chunk");
                }


                Integer chunkIndex = request.getChunkIndex();
                if(chunkIndex == null){
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_INDEX",
                                        "Chunk index không đc để trống ");
                }

                if(chunkIndex < 0 || chunkIndex >=session.getTotalChunks()){
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_INDEX",
                                        "Chunk index nằm ngoài phạm vi cho phép");
                }

                MultipartFile file = request.getFile();
                if(file == null || file.isEmpty()){
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_FILE",
                                        "Chunk file không đc để trống ");
                }
                if(file.getSize() > session.getChunkSize()){
                         throw new BusinessException(
                                        HttpStatus.PAYLOAD_TOO_LARGE,
                                        "ERR_CHUNK_TOO_LARGE",
                                        "Chunk vượt quá kích thước cho phép ");
                }

                // kiem tra chunk da upload chua
                if(uploadSessionRedisService.isChunkUploaded(uploadSessionId, chunkIndex)){
                         throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "CHUNK_ALREADY_EXISTS",
                                        "Chunk đã được upload");
                }

                // lay chunksum tu fe gui
                String checksumMD5 =request.getChecksumMD5();
                if(checksumMD5 == null || checksumMD5.isBlank()){
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNKSUM",
                                        "Checksum MD5 không được để trống");
                }

                String calculatedMD5;
                try {
                        // Tao cong cu tinh MD5
                        MessageDigest md = MessageDigest.getInstance("MD5");
                        // doc toan bo du lieu trong chunk thanh mang byte
                        byte[] fileBytes = file.getBytes();
                        byte[] digest = md.digest(fileBytes);  
                        // tao stringbuider de chuyen MD5 dang  bytes thanh chuoi hexadecimal
                        StringBuilder hexString = new  StringBuilder();
                        for(byte s:digest){
                                hexString.append(String.format("%02x", s));
                        }
                        calculatedMD5 = hexString.toString();
                } catch (NoSuchAlgorithmException  e) {
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "MD5_ERROR",
                                        "không thể tính MD5");
                }catch(Exception e){
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "CHUNK_READ_ERROR",
                                        "Không thể đọc dữ liệu chunk");
                }
                // so sanh MD5 FE va BE
                if(!calculatedMD5.equalsIgnoreCase(calculatedMD5.trim())){
                        return  ChunkUploadResponse.builder()
                                                   .uploadSessionId(sessionIdString)
                                                   .chunkIndex(chunkIndex)
                                                   .status("CHECKSUM_MISMATCH")
                                                   .message("Chunk checksum du lieu khong khop")
                                                   .build();
                }

                // tao obj cho chunk
                String objectKey="tmp/"
                        +uploadSessionId
                        +"/chunk_"
                        +chunkIndex;


                // upload chunk vao minio
                try {
                        minioService.upLoad(file, objectKey);
                } catch (Exception e) {
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "ERR_MINIO_UNAVAILABLE",
                                        "Không thể lưu chunk vào MinIO");
                }

                // danh giau chunk da upload trong redis
                uploadSessionRedisService.markChunkUploaded(uploadSessionId, chunkIndex);
                // tang so luong chunk da nhan 
                int receivedChunks = session.getReceivedChunks();
                session.setReceivedChunks(receivedChunks+1);

                // Đổi INITIATED → UPLOADING
                if(session.getStatus() == UploadSessionStatus.INITIATED){
                        session.setStatus(UploadSessionStatus.UPLOADING);
                }

                // luu session mo vao redis
                uploadSessionRedisService.save(session);
                return ChunkUploadResponse.builder()
                                          .uploadSessionId(sessionIdString)
                                          .chunkIndex(chunkIndex)
                                          .status("SUCCESS")
                                          .message(objectKey)
                                          .build();

        }
}
