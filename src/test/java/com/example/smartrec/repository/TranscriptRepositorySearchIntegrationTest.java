package com.example.smartrec.repository;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.Transcript;

/**
 * Kiểm thử tích hợp truy vấn JPQL thực thi trên PostgreSQL. Chạy có chủ ý bằng
 * {@code -Dsmartrec.integration=true}; DataJpaTest bao fixture trong transaction và rollback sau
 * test. Khởi tạo schema và cập nhật DDL được tắt để test không thay đổi cấu trúc database.
 */
@DataJpaTest(properties = {
        "spring.sql.init.mode=never",
        "spring.jpa.hibernate.ddl-auto=none",
        "logging.level.root=WARN"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@EnabledIfSystemProperty(named = "smartrec.integration", matches = "true")
class TranscriptRepositorySearchIntegrationTest {
    private static final UUID MEETING_ID = UUID.fromString("51000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_MEETING_ID = UUID.fromString("51000000-0000-0000-0000-000000000002");
    private static final UUID JOB_ID = UUID.fromString("52000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_JOB_ID = UUID.fromString("52000000-0000-0000-0000-000000000002");

    @Autowired
    private TranscriptRepository transcriptRepository;
    @Autowired
    private SpeakerRepository speakerRepository;

    @Test
    void searchesLiteralSpecialCharactersVietnameseTextAndStableMeetingScopedPages() {
        UUID speakerId = UUID.fromString("54000000-0000-0000-0000-000000000001");

        speakerRepository.save(Speaker.builder()
                .id(speakerId)
                .meetingId(MEETING_ID)
                .aiLabel("SPEAKER_1")
                .build());
        // Hai hit cùng timestamp để kiểm tra ID nguồn làm tiêu chí phụ khi tách trang.
        // Bản ghi decoy sẽ bị LIKE không escape khớp nhầm; meeting còn lại chứa cùng từ khóa nhưng
        // phải nằm ngoài phạm vi meeting/job đang truy vấn.
        transcriptRepository.saveAll(List.of(
                transcript(MEETING_ID, JOB_ID, speakerId, 8_000L, "Call out 100%_READY before release."),
                transcript(MEETING_ID, JOB_ID, 8_000L, "100%_ready was confirmed by the team."),
                transcript(MEETING_ID, JOB_ID, 9_000L, "100xxready is not the requested text."),
                transcript(OTHER_MEETING_ID, OTHER_JOB_ID, 8_000L, "100%_ready belongs to another meeting."),
                transcript(MEETING_ID, JOB_ID, 12_000L, "Mình đã lưu ĐƯỜNG DẪN vào ghi chú.")));
        transcriptRepository.flush();

        Sort stableOrder = Sort.by(Sort.Order.asc("startTimeMs"), Sort.Order.asc("id"));
        Page<Transcript> firstPage = transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                MEETING_ID, JOB_ID, "100%_ready", PageRequest.of(0, 1, stableOrder));
        Page<Transcript> secondPage = transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                MEETING_ID, JOB_ID, "100%_ready", PageRequest.of(1, 1, stableOrder));
        Page<Transcript> allSpecialCharacterMatches = transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                MEETING_ID, JOB_ID, "100%_ready", PageRequest.of(0, 10, stableOrder));
        Page<Transcript> vietnameseMatches = transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                MEETING_ID, JOB_ID, "đường dẫn", PageRequest.of(0, 10, stableOrder));
        Page<Transcript> speakerMatches = transcriptRepository.findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(
                MEETING_ID, JOB_ID, speakerId, "100%_ready", PageRequest.of(0, 10, stableOrder));

        assertEquals(2, firstPage.getTotalElements());
        assertEquals(allSpecialCharacterMatches.getContent().get(0).getId(), firstPage.getContent().get(0).getId());
        assertEquals(allSpecialCharacterMatches.getContent().get(1).getId(), secondPage.getContent().get(0).getId());
        assertEquals(1, vietnameseMatches.getTotalElements());
        assertEquals(12_000L, vietnameseMatches.getContent().get(0).getStartTimeMs());
        assertEquals(1, speakerMatches.getTotalElements());
        assertEquals(speakerId, speakerMatches.getContent().get(0).getSpeakerId());
        assertTrue(speakerRepository.existsByIdAndMeetingId(speakerId, MEETING_ID));
        assertFalse(speakerRepository.existsByIdAndMeetingId(speakerId, OTHER_MEETING_ID));
        assertTrue(transcriptRepository.existsByProcessingJobIdAndMeetingId(JOB_ID, MEETING_ID));
        assertFalse(transcriptRepository.existsByProcessingJobIdAndMeetingId(OTHER_JOB_ID, MEETING_ID));
    }

    private Transcript transcript(UUID meetingId, UUID jobId, long startTimeMs, String text) {
        return transcript(meetingId, jobId, null, startTimeMs, text);
    }

    private Transcript transcript(
            UUID meetingId, UUID jobId, UUID speakerId, long startTimeMs, String text) {
        return Transcript.builder()
                .meetingId(meetingId)
                .processingJobId(jobId)
                .speakerId(speakerId)
                .startTimeMs(startTimeMs)
                .endTimeMs(startTimeMs + 1_000)
                .textContent(text)
                .attributionStatus("UNRESOLVED")
                .build();
    }
}
