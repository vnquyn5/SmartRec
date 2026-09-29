package com.example.smartrec.service.impl;

import com.example.smartrec.controller.AuthController;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
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
import com.example.smartrec.model.dto.MergeUploadReponse;
import com.example.smartrec.model.dto.MergeUploadRequest;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.DurationValidationService;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.UploadService;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class UploadServiceImpl implements UploadService {
        private final AuthController authController;
        private final UserRepository userRepository;
        private final UploadSessionRedisService uploadSessionRedisService;
        private final MinioService minioService;
        private final DurationValidationService durationValidationService;

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
                } catch (IllegalArgumentException e) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "Upload session ID không hợp lệ");
                }
                User crusUser = getCurrentUser();
                UploadSession session = uploadSessionRedisService.get(uploadSessionId);

                if (!session.getUserId().equals(crusUser.getId())) {
                        throw new BusinessException(
                                        HttpStatus.FORBIDDEN,
                                        "UPLOAD_SESSION_NOT_OWNED",
                                        "Upload session không thuộc người dùng hiện tại");
                }

                if (session.getStatus() != UploadSessionStatus.INITIATED
                                && session.getStatus() != UploadSessionStatus.UPLOADING) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "INVALID_UPLOAD_SESSION_STATUS",
                                        "Upload session không ở trạng thái cho phép upload chunk");
                }

                Integer chunkIndex = request.getChunkIndex();
                if (chunkIndex == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_INDEX",
                                        "Chunk index không đc để trống ");
                }

                if (chunkIndex < 0 || chunkIndex >= session.getTotalChunks()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_INDEX",
                                        "Chunk index nằm ngoài phạm vi cho phép");
                }

                MultipartFile file = request.getFile();
                if (file == null || file.isEmpty()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_FILE",
                                        "Chunk file không đc để trống ");
                }
                if (file.getSize() > session.getChunkSize()) {
                        throw new BusinessException(
                                        HttpStatus.PAYLOAD_TOO_LARGE,
                                        "ERR_CHUNK_TOO_LARGE",
                                        "Chunk vượt quá kích thước cho phép ");
                }

                // kiem tra chunk da upload chua
                if (uploadSessionRedisService.isChunkUploaded(uploadSessionId, chunkIndex)) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "CHUNK_ALREADY_EXISTS",
                                        "Chunk đã được upload");
                }

                // lay chunksum tu fe gui
                String checksumMD5 = request.getChecksumMD5();
                if (checksumMD5 == null || checksumMD5.isBlank()) {
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
                        // tao stringbuider de chuyen MD5 dang bytes thanh chuoi hexadecimal
                        StringBuilder hexString = new StringBuilder();
                        for (byte s : digest) {
                                hexString.append(String.format("%02x", s));
                        }
                        calculatedMD5 = hexString.toString();
                } catch (NoSuchAlgorithmException e) {
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "MD5_ERROR",
                                        "không thể tính MD5");
                } catch (Exception e) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "CHUNK_READ_ERROR",
                                        "Không thể đọc dữ liệu chunk");
                }
                // so sanh MD5 FE va BE
                if (!calculatedMD5.equalsIgnoreCase(calculatedMD5.trim())) {
                        return ChunkUploadResponse.builder()
                                        .uploadSessionId(sessionIdString)
                                        .chunkIndex(chunkIndex)
                                        .status("CHECKSUM_MISMATCH")
                                        .message("Chunk checksum du lieu khong khop")
                                        .build();
                }

                // tao obj cho chunk
                String objectKey = "tmp/"
                                + uploadSessionId
                                + "/chunk_"
                                + chunkIndex;

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
                session.setReceivedChunks(receivedChunks + 1);

                // Đổi INITIATED → UPLOADING
                if (session.getStatus() == UploadSessionStatus.INITIATED) {
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

        @Override
        public MergeUploadReponse mergeUpload(MergeUploadRequest request) {
                // xac thu yeu cau
                if (request == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "merge request không được để null");
                }

                // xac thu ma UploadSessionId
                String sessionIdString = request.getUploadSessionId();
                if (sessionIdString == null || sessionIdString.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "upload session id không được để null");
                }

                UUID uploadSessionId;
                try {
                        uploadSessionId = UUID.fromString(sessionIdString);
                } catch (IllegalArgumentException e) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "upload session id không hợp lệ");
                }

                // lay user hien tai
                User currUser = getCurrentUser();

                // lay session tu redis
                UploadSession session = uploadSessionRedisService.get(uploadSessionId);
                // session khong ton tai
                if (session == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "UPLOAD_SESSION_NOT_FOUND",
                                        "không tìm thấy upload session ");
                }
                // kiem tra quyen so huu khong
                if (!session.getUserId().equals(currUser.getId())) {
                        throw new BusinessException(
                                        HttpStatus.FORBIDDEN,
                                        "UPLOAD_SESSION_NOT_OWNED",
                                        "Upload session không thuộc người dùng hiện tại");
                }
                // kiem tra trạng thai session
                if (session.getStatus() != UploadSessionStatus.INITIATED
                                && session.getStatus() != UploadSessionStatus.UPLOADING) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "INVALID_UPLOAD_SESSION_STATUS",
                                        "Upload session không ở trạng thái cho phép merge");
                }
                // lay tong chunk
                Integer totalChunk = session.getTotalChunks();
                if (totalChunk == null || totalChunk <= 0) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_TOTAL_CHUNKS",
                                        "total chunk không hợp lệ ");
                }

                // tim chunk bi thieu

                // danh sach dung de luu index cua nhung chunk chua upload
                List<Integer> missingChunk = new ArrayList<>();
                for (int i = 0; i < totalChunk; i++) {
                        boolean uploaded = uploadSessionRedisService.isChunkUploaded(uploadSessionId, i); // Kiểm tra
                                                                                                          // chunk thứ i
                                                                                                          // đã được
                                                                                                          // upload chưa
                        if (!uploaded) {// neu chua upload
                                missingChunk.add(i);// them index chunk bi thieu vao danh sach
                        }
                }

                // neu chunk bi thieu se khong merge
                if (!missingChunk.isEmpty()) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "UPLOAD_INCOMPLETE",
                                        "1 so phan bi thieu :" + missingChunk);
                }
                // tao danh sach object key cua chunk
                List<String> chunkObjectKeys = new ArrayList<>();
                for (int i = 0; i < totalChunk; i++) {
                        String chunkObjectKey = "tmp/"
                                        + uploadSessionId
                                        + "/chunk_"
                                        + i;

                        chunkObjectKeys.add(chunkObjectKey);
                }

                String fileName = request.getFileName();
                if (fileName == null || fileName.isBlank()) {
                        fileName = session.getFileName();// lay ten file trong upload session
                }
                if (fileName == null || fileName.isBlank()) { // neu ca reuest voi session dau khong co ten file
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_FILENAME",
                                        "Tên file không được để trống");
                }
                fileName = fileName.trim();

                // tao object key cuoi cung
                String finalObjectKey = "meetings/"
                                + currUser.getId()
                                + "/"
                                + uploadSessionId
                                + "/"
                                + fileName;

                // ghep cac chunk trong miniio
                try {
                        minioService.composeObjects(finalObjectKey, chunkObjectKeys);// gui ds chunk trog mini de ghep
                                                                                     // thanh file hoan chinh
                } catch (Exception e) {
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "ERR_MINIO_COMPOSE",
                                        "Không thể merge các chunk trong MinIO");
                }

                // danh giau session da hoan thanh
                session.setStatus(UploadSessionStatus.COMPLETED);

                uploadSessionRedisService.save(session);

                // xoa chunk tam 
                for(String chunkObjectKey : chunkObjectKeys){// duyet qua tung chunk da dung de compose
                        try {
                                minioService.delete(chunkObjectKey);// xoa chunk tam thoi khoi mini
                        } catch (Exception e) {
                        }
                }
                return new MergeUploadReponse(sessionIdString,fileName,finalObjectKey,UploadSessionStatus.COMPLETED.name());
        }
        
        private void validateMediaDuration(String objectKey){
                Path temFile=null; // luu bien duong dan cua file tam
                try {
                        // dow file hoan chinh tu mini
                        InputStream inputStream= minioService.downloadObject(objectKey);// goi miniSer dee lay file tu mini
                        // tao file tam thoi
                        temFile = Files.createTempFile("smartrec-",".media");
                                  // file doc tu mini            // neu file dit dã ton tai
                        Files.copy(inputStream, temFile,StandardCopyOption.REPLACE_EXISTING);
                        durationValidationService.validateDuration(temFile.toString());// dunng ff de kiem tra duration va chuyen path thanh string de truyn cho sevice
                }catch(BusinessException e){
                        throw e;
                }catch (Exception e) {
                        // kh tao dc file tam,k copy dc file,k doc inputStream,..
                        throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_MEDIA_METADATA_READ_FAILED", "Không thể kiểm tra metadata của media");
                }finally{
                        // xoa file tam
                        if(temFile!=null){
                                try {
                                       Files.deleteIfExists(temFile); // xoa file tam
                                } catch (Exception ignored) {
                                        // neu xoa file tam that bai thi bo qua 
                                        // khong lam reuest chinh bi xong
                                }
                                
                        }
                }

        }

}
