package com.example.smartrec.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.core.task.TaskRejectedException;
import com.example.smartrec.exception.GlobalExceptionHandler;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.example.smartrec.controller.UploadController;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.UploadSessionStatus;
import com.example.smartrec.model.UploadSession;
import com.example.smartrec.repository.UploadSessionRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.UploadServiceImpl;
import com.example.smartrec.service.impl.UploadSessionRedisServiceImpl;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.SetOperations;

class ChunkUploadTimingTest {
    @Test
    @SuppressWarnings("unchecked")
    void statusUsesExactRedisMarkersWhenIndex417IsMissing() throws Exception {
        UUID id = UUID.randomUUID();
        User user = User.builder().id(UUID.randomUUID()).email("alice@example.com").build();
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken(user.getEmail(), null, "ROLE_USER"));
        var session = UploadSession.builder().uploadSessionId(id).userId(user.getId()).totalChunks(553)
                .receivedChunks(553).status(UploadSessionStatus.UPLOADING).build();
        RedisTemplate<String, Object> template = mock(RedisTemplate.class);
        ValueOperations<String, Object> values = mock(ValueOperations.class);
        SetOperations<String, Object> markers = mock(SetOperations.class);
        when(template.opsForValue()).thenReturn(values);
        when(template.opsForSet()).thenReturn(markers);
        when(values.get("upload:session:" + id)).thenReturn(session);
        java.util.Set<Object> indexes = new java.util.HashSet<>();
        for (int i = 0; i < 553; i++) if (i != 417) indexes.add(i);
        when(markers.members("upload:session:chunks:" + id)).thenReturn(indexes);
        when(markers.size("upload:session:chunks:" + id)).thenReturn(552L);
        UploadSessionRepository sessions = mock(UploadSessionRepository.class);
        when(sessions.findByIdAndUserId(id, user.getId())).thenReturn(Optional.of(
                com.example.smartrec.entity.UploadSession.builder().id(id).userId(user.getId())
                        .receivedChunks(553).totalChunks(553).status(UploadSessionStatus.UPLOADING).build()));
        MinioService minio = mock(MinioService.class);
        UploadServiceImpl service = new UploadServiceImpl(null, users, sessions, null, null,
                new UploadSessionRedisServiceImpl(template), minio, null, mock(ChunkMergeAsyncService.class), null);
        MockMvcBuilders.standaloneSetup(new UploadController(service, mock(FileService.class))).build()
                .perform(get("/upload/status").param("uploadSessionId", id.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.receivedChunks").value(552))
                .andExpect(jsonPath("$.missingChunks.length()").value(1))
                .andExpect(jsonPath("$.missingChunks[0]").value(417));
        verifyNoInteractions(minio);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @ParameterizedTest
    @ValueSource(strings = {"none", "db", "stage", "finalization", "merge-dispatch", "redis-session", "idempotent", "put", "marker"})
    void finalChunkAcceptanceSurvivesPostAcceptanceFailures(String failure) throws Exception {
        UserRepository users = mock(UserRepository.class);
        UploadSessionRepository sessions = mock(UploadSessionRepository.class);
        UploadSessionRedisService redis = mock(UploadSessionRedisService.class);
        MinioService minio = mock(MinioService.class);
        ChunkMergeAsyncService background = mock(ChunkMergeAsyncService.class);
        User user = User.builder().id(UUID.randomUUID()).email("alice@example.com").build();
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken(user.getEmail(), null, "ROLE_USER"));
        when(users.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        UUID sessionId = UUID.randomUUID();
        UploadSession session = UploadSession.builder().uploadSessionId(sessionId).userId(user.getId())
                .fileName("large.mp4").fileSize(553L * 5 * 1024 * 1024).totalChunks(553)
                .chunkSize(5L * 1024 * 1024).receivedChunks(552).status(UploadSessionStatus.UPLOADING).build();
        when(redis.get(sessionId)).thenReturn(session);
        when(redis.uploadedChunkCount(sessionId)).thenReturn(552L, 553L);
        UploadServiceImpl service = new UploadServiceImpl(
                null, users, sessions, null, null, redis, minio, null, background, null);
        java.util.List<Runnable> queued = new java.util.ArrayList<>();
        if (failure.equals("merge-dispatch")) {
            doAnswer(inv -> { queued.add(inv.getArgument(0)); return null; }).when(background).executeAsync(any());
            doThrow(new TaskRejectedException("merge rejected")).when(background).mergeAsync(any());
            when(sessions.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.of(
                    com.example.smartrec.entity.UploadSession.builder().id(sessionId).userId(user.getId())
                            .totalChunks(553).receivedChunks(552).status(UploadSessionStatus.UPLOADING).build()));
        }
        if (failure.equals("db")) {
            when(sessions.updateProgressForUser(any(), any(), any(), any()))
                    .thenThrow(new InvalidDataAccessApiUsageException("Executing an update/delete query"));
        }
        if (failure.equals("stage")) doThrow(new TaskRejectedException("stage rejected"))
                .when(background).stageChunkGroupAsync(sessionId, 553, 552);
        if (failure.equals("finalization")) doThrow(new TaskRejectedException("finalization rejected"))
                .when(background).executeAsync(any());
        if (failure.equals("redis-session")) doThrow(new IllegalStateException("session save failed"))
                .when(redis).save(any());
        if (failure.equals("idempotent")) {
            when(redis.isChunkUploaded(sessionId, 552)).thenReturn(true);
            when(minio.objectExists("tmp/" + sessionId + "/chunk_552")).thenReturn(true);
        }
        if (failure.equals("put")) doThrow(new IllegalStateException("MinIO unavailable"))
                .when(minio).upLoad(any(), any());
        if (failure.equals("marker")) doThrow(new IllegalStateException("Redis unavailable"))
                .when(redis).markChunkUploaded(sessionId, 552);
        byte[] bytes = "final chunk".getBytes(StandardCharsets.UTF_8);
        String checksum = HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(bytes));

        MockMvcBuilders.standaloneSetup(new UploadController(service, mock(FileService.class)))
                .setControllerAdvice(new GlobalExceptionHandler()).build()
                .perform(multipart("/upload/chunk")
                        .file(new MockMultipartFile("file", "chunk.bin", "application/octet-stream", bytes))
                        .param("uploadSessionId", sessionId.toString())
                        .param("chunkIndex", "552").param("checksumMD5", checksum))
                .andExpect(status().is(failure.equals("put") || failure.equals("marker") ? 500 : 200));

        if (failure.equals("put") || failure.equals("marker")) {
            verifyNoInteractions(background);
            verify(sessions, never()).updateStatusForUser(any(), any(), any());
            return;
        }
        if (failure.equals("idempotent")) {
            verify(minio).objectExists("tmp/" + sessionId + "/chunk_552");
            verify(minio, never()).upLoad(any(), any());
            verify(redis, never()).markChunkUploaded(any(), any());
        } else {
            verify(minio).upLoad(any(), any());
            verify(redis).markChunkUploaded(sessionId, 552);
        }
        verify(background).stageChunkGroupAsync(sessionId, 553, 552);
        verify(background).executeAsync(any(Runnable.class));
        if (failure.equals("merge-dispatch")) {
            queued.get(0).run();
            org.junit.jupiter.api.Assertions.assertEquals(UploadSessionStatus.MERGE_FAILED, session.getStatus());
            verify(sessions).updateStatusForUser(sessionId, user.getId(), UploadSessionStatus.MERGE_FAILED);
        }
        verifyNoMoreInteractions(minio);
    }
}
