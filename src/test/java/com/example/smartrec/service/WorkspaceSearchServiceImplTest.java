package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.ResourceNotFoundException;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.WorkspaceSearchHitDTO;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.TranscriptRepository;
import com.example.smartrec.service.impl.WorkspaceSearchServiceImpl;

/**
 * Kiểm thử đơn vị cho thứ tự kiểm tra quyền/chọn dữ liệu và ánh xạ response của service.
 * Repository được mock để các test này không phụ thuộc PostgreSQL; ngữ nghĩa truy vấn thật được
 * kiểm tra riêng trong TranscriptRepositorySearchIntegrationTest.
 */
@ExtendWith(MockitoExtension.class)
class WorkspaceSearchServiceImplTest {
    private static final UUID MEETING_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID JOB_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID TRANSCRIPT_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final UUID SPEAKER_ID = UUID.fromString("40000000-0000-0000-0000-000000000001");

    @Mock
    private MeetingService meetingService;
    @Mock
    private JobRepository jobRepository;
    @Mock
    private SpeakerRepository speakerRepository;
    @Mock
    private TranscriptRepository transcriptRepository;

    private WorkspaceSearchServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new WorkspaceSearchServiceImpl(
                meetingService, jobRepository, speakerRepository, transcriptRepository);
    }

    @Test
    void returnsTranscriptIdsSpeakerAndMillisecondTimestampWithTrimmedQuery() {
        givenReadySource();
        Transcript transcript = transcript("Spring Boot will ship next week.", 12_500L, null);
        when(transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq("Spring Boot"), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(transcript), PageRequest.of(0, 20), 1));

        PageResponse<WorkspaceSearchHitDTO> result = service.searchMeetingTranscript(
                MEETING_ID, "  Spring Boot  ", null, null, null);

        assertEquals(1, result.getContent().size());
        WorkspaceSearchHitDTO hit = result.getContent().get(0);
        assertEquals(TRANSCRIPT_ID, hit.getSourceId());
        assertEquals("Spring Boot will ship next week.", hit.getSnippet());
        assertEquals(12_500L, hit.getStartTimeMs());
        assertNull(hit.getSpeakerId());
        assertNull(hit.getSpeakerName());
        assertNull(hit.getSpeakerLabel());
        assertEquals(0, result.getPage());
        assertEquals(20, result.getSize());
        assertEquals(1L, result.getTotalElements());
        assertEquals(1, result.getTotalPages());

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(transcriptRepository).findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq("Spring Boot"), pageable.capture());
        assertEquals(20, pageable.getValue().getPageSize());
        assertEquals("startTimeMs", pageable.getValue().getSort().getOrderFor("startTimeMs").getProperty());
        assertEquals("id", pageable.getValue().getSort().getOrderFor("id").getProperty());
        assertEquals(org.springframework.data.domain.Sort.Direction.ASC,
                pageable.getValue().getSort().getOrderFor("startTimeMs").getDirection());
    }

    @Test
    void scopesSearchToMeetingAndActiveJobAndTreatsWildcardCharactersLiterally() {
        // Chuyển nguyên từ khóa xuống repository: ContainingIgnoreCase coi '%' và '_' là ký tự thường.
        // meetingId và jobId cũng được truyền riêng để không khớp dữ liệu ngoài phạm vi.
        givenReadySource();
        when(transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq("100%_ready"), any(Pageable.class)))
                .thenReturn(Page.empty(PageRequest.of(0, 10)));

        PageResponse<WorkspaceSearchHitDTO> result = service.searchMeetingTranscript(
                MEETING_ID, "100%_ready", null, 0, 10);

        assertEquals(List.of(), result.getContent());
        verify(transcriptRepository).findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq("100%_ready"), any(Pageable.class));
    }

    @Test
    void appliesSpeakerFilterAndReturnsSpeakerIdentity() {
        givenReadySource();
        Transcript transcript = transcript("Project plan", 7_000L, SPEAKER_ID);
        Speaker speaker = Speaker.builder()
                .id(SPEAKER_ID)
                .meetingId(MEETING_ID)
                .realName("Lan")
                .aiLabel("SPEAKER_1")
                .build();
        when(speakerRepository.existsByIdAndMeetingId(SPEAKER_ID, MEETING_ID)).thenReturn(true);
        when(transcriptRepository.findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq(SPEAKER_ID), eq("plan"), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(transcript), PageRequest.of(0, 20), 1));
        when(speakerRepository.findAllById(List.of(SPEAKER_ID))).thenReturn(List.of(speaker));

        PageResponse<WorkspaceSearchHitDTO> result = service.searchMeetingTranscript(
                MEETING_ID, "plan", SPEAKER_ID, 0, 20);

        WorkspaceSearchHitDTO hit = result.getContent().get(0);
        assertEquals(SPEAKER_ID, hit.getSpeakerId());
        assertEquals("Lan", hit.getSpeakerName());
        assertEquals("SPEAKER_1", hit.getSpeakerLabel());
        verify(transcriptRepository).findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq(SPEAKER_ID), eq("plan"), any(Pageable.class));
    }

    @Test
    void successfulSearchWithNoHitsReturnsEmptyPage() {
        givenReadySource();
        when(transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq("absent"), any(Pageable.class)))
                .thenReturn(Page.empty(PageRequest.of(0, 20)));

        PageResponse<WorkspaceSearchHitDTO> result = service.searchMeetingTranscript(
                MEETING_ID, "absent", null, 0, 20);

        assertEquals(List.of(), result.getContent());
        assertEquals(0L, result.getTotalElements());
        assertEquals(0, result.getTotalPages());
    }

    @Test
    void deniesMeetingBeforeLookingUpJobSpeakerOrTranscripts() {
        when(meetingService.getMeeting(MEETING_ID)).thenThrow(
                new BusinessException(HttpStatus.FORBIDDEN, "MEETING_ACCESS_DENIED", "Access denied"));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "term", SPEAKER_ID, 0, 20));

        assertEquals(HttpStatus.FORBIDDEN, exception.getStatus());
        verify(jobRepository, never()).findById(any());
        verify(speakerRepository, never()).existsByIdAndMeetingId(any(), any());
        verify(transcriptRepository, never()).existsByProcessingJobIdAndMeetingId(any(), any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(any(), any(), any(), any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(any(), any(), any(), any(), any());
    }

    @Test
    void forwardsMeetingNotFoundBeforeLookingUpTheActiveJob() {
        when(meetingService.getMeeting(MEETING_ID)).thenThrow(
                new ResourceNotFoundException("MEETING_NOT_FOUND", "Meeting not found"));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "term", null, 0, 20));

        assertEquals(HttpStatus.NOT_FOUND, exception.getStatus());
        assertEquals("MEETING_NOT_FOUND", exception.getCode());
        verify(jobRepository, never()).findById(any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(any(), any(), any(), any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(any(), any(), any(), any(), any());
    }

    @Test
    void validatesSpeakerBelongsToMeetingBeforeTranscriptQuery() {
        givenActiveJobWithoutTranscriptCheck();
        when(speakerRepository.existsByIdAndMeetingId(SPEAKER_ID, MEETING_ID)).thenReturn(false);

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "term", SPEAKER_ID, 0, 20));

        assertEquals(HttpStatus.BAD_REQUEST, exception.getStatus());
        assertEquals("INVALID_SPEAKER_ID", exception.getCode());
        verify(transcriptRepository, never()).existsByProcessingJobIdAndMeetingId(any(), any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(any(), any(), any(), any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(any(), any(), any(), any(), any());
    }

    @Test
    void returnsConflictWhenMeetingHasNoActiveJob() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meeting(null));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "term", null, 0, 20));

        assertEquals(HttpStatus.CONFLICT, exception.getStatus());
        assertEquals("TRANSCRIPT_NOT_READY", exception.getCode());
        verify(jobRepository, never()).findById(any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(any(), any(), any(), any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(any(), any(), any(), any(), any());
    }

    @Test
    void returnsConflictWhenActiveJobHasNoTranscriptRows() {
        givenActiveJobWithoutTranscriptCheck();
        when(transcriptRepository.existsByProcessingJobIdAndMeetingId(JOB_ID, MEETING_ID)).thenReturn(false);

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "term", null, 0, 20));

        assertEquals(HttpStatus.CONFLICT, exception.getStatus());
        assertEquals("TRANSCRIPT_NOT_READY", exception.getCode());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(any(), any(), any(), any());
        verify(transcriptRepository, never()).findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(any(), any(), any(), any(), any());
    }

    @Test
    void rejectsBlankQueryAndInvalidPagination() {
        BusinessException blankQuery = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "  ", null, 0, 20));
        assertEquals("INVALID_SEARCH_QUERY", blankQuery.getCode());

        BusinessException negativePage = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "term", null, -1, 20));
        assertEquals("INVALID_PAGINATION", negativePage.getCode());

        BusinessException zeroSize = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "term", null, 0, 0));
        assertEquals("INVALID_PAGINATION", zeroSize.getCode());

        BusinessException oversized = assertThrows(BusinessException.class,
                () -> service.searchMeetingTranscript(MEETING_ID, "term", null, 0, 51));
        assertEquals("INVALID_PAGINATION", oversized.getCode());
    }

    @Test
    void checksMeetingBeforeQueryingTheActiveJobAndTranscriptSource() {
        givenReadySource();
        when(transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq("term"), any(Pageable.class)))
                .thenReturn(Page.empty(PageRequest.of(0, 20)));

        service.searchMeetingTranscript(MEETING_ID, "term", null, 0, 20);

        // Xác nhận ranh giới quyền bằng thứ tự gọi, không chỉ kiểm tra giá trị trả về cuối cùng.
        InOrder order = inOrder(meetingService, jobRepository, transcriptRepository);
        order.verify(meetingService).getMeeting(MEETING_ID);
        order.verify(jobRepository).findById(JOB_ID);
        order.verify(transcriptRepository).existsByProcessingJobIdAndMeetingId(JOB_ID, MEETING_ID);
        order.verify(transcriptRepository).findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                eq(MEETING_ID), eq(JOB_ID), eq("term"), any(Pageable.class));
    }

    /** Chuẩn bị meeting có ít nhất một transcript đã lưu trong job đang được chọn. */
    private void givenReadySource() {
        givenActiveJobWithoutTranscriptCheck();
        when(transcriptRepository.existsByProcessingJobIdAndMeetingId(JOB_ID, MEETING_ID)).thenReturn(true);
    }

    /** Chuẩn bị quyền meeting và active job, chưa cấu hình trạng thái sẵn sàng transcript. */
    private void givenActiveJobWithoutTranscriptCheck() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meeting(JOB_ID));
        when(jobRepository.findById(JOB_ID)).thenReturn(Optional.of(
                Job.builder().id(JOB_ID).meetingId(MEETING_ID).build()));
    }

    private MeetingResponseDTO meeting(UUID activeJobId) {
        return new MeetingResponseDTO(
                MEETING_ID, "Weekly sync", MeetingStatus.COMPLETED,
                null, null, null, null, null, null, null, activeJobId);
    }

    private Transcript transcript(String text, long startTimeMs, UUID speakerId) {
        return Transcript.builder()
                .id(TRANSCRIPT_ID)
                .meetingId(MEETING_ID)
                .processingJobId(JOB_ID)
                .speakerId(speakerId)
                .startTimeMs(startTimeMs)
                .endTimeMs(startTimeMs + 1_000)
                .textContent(text)
                .attributionStatus(speakerId == null ? "UNRESOLVED" : "ATTRIBUTED")
                .build();
    }
}
