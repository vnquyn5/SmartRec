package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.JobSnapshotDTO;
import com.example.smartrec.service.JobProgressAccessService;
import com.example.smartrec.service.JobProgressService;

@ExtendWith(MockitoExtension.class)
// Kiểm tra hai đường đọc tiến độ: request qua STOMP và endpoint snapshot qua REST.
class WebSocketProgressTest {
    @Mock private JobProgressAccessService accessService;
    @Mock private JobProgressService progressService;
    @Mock private SimpMessagingTemplate messagingTemplate;
    @InjectMocks private WebSocketProgress webSocketProgress;

    // Người có quyền đọc phải nhận snapshot riêng trong queue của chính mình.
    @Test
    void inboundReadChecksMeetingJobScopeAndRepliesOnlyToRequestingUser() {
        UUID meetingId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        JobSnapshotDTO snapshot = new JobSnapshotDTO(jobId, meetingId, "PROCESSING", "FFMPEG", 0, 4L, null);
        when(progressService.getSnapshot(jobId)).thenReturn(snapshot);

        webSocketProgress.getProgress(new WebSocketProgress.ProgressRequest(meetingId, jobId),
                new UsernamePasswordAuthenticationToken("reader@example.com", null));

        verify(accessService).assertCanReadJob(meetingId, jobId, "reader@example.com");
        verify(progressService).getSnapshot(jobId);
        verify(messagingTemplate).convertAndSendToUser("reader@example.com", "/queue/ai-progress", snapshot);
    }

    // Từ chối quyền đọc thì không được truy vấn hay gửi snapshot ra queue.
    @Test
    void inboundReadDoesNotReturnStateWhenAccessCheckFails() {
        UUID meetingId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        doThrow(new BusinessException(HttpStatus.FORBIDDEN, "MEETING_ACCESS_DENIED", "denied"))
                .when(accessService).assertCanReadJob(meetingId, jobId, "other@example.com");

        assertThrows(BusinessException.class, () -> webSocketProgress.getProgress(
                new WebSocketProgress.ProgressRequest(meetingId, jobId),
                new UsernamePasswordAuthenticationToken("other@example.com", null)));

        verify(progressService, never()).getSnapshot(jobId);
        verify(messagingTemplate, never()).convertAndSendToUser(
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any());
    }

    // Endpoint REST áp dụng cùng kiểm tra quyền với luồng WebSocket.
    @Test
    void restSnapshotUsesSameMeetingJobPermissionCheck() {
        UUID jobId = UUID.randomUUID();
        JobProgressController controller = new JobProgressController(progressService, accessService);

        var response = controller.getSnapshot(jobId,
                new UsernamePasswordAuthenticationToken("reader@example.com", null));

        verify(accessService).assertCanReadJob(jobId, "reader@example.com");
        verify(progressService).getSnapshot(jobId);
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }
}
