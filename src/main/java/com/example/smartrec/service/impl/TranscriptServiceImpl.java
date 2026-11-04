package com.example.smartrec.service.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.TranscriptItemRequest;
import com.example.smartrec.model.dto.TranscriptRequest;
import com.example.smartrec.model.dto.TranscriptResponse;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.repository.TranscriptRepository;
import com.example.smartrec.service.TranscriptService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class TranscriptServiceImpl implements TranscriptService {
    private final TranscriptRepository transcriptRepository;
    private final MeetingRepository meetingRepository;
    private final JobRepository jobRepository;
    private final SpeakerSegmentRepository speakerSegmentRepository;

     @Override
    @Transactional (rollbackFor = Exception.class)
    public List<TranscriptResponse> saveTranscript(TranscriptRequest request) {

        // Kiểm tra request
        if (request == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TRANSCRIPT_REQUEST",
                    "Transcript request không được để trống"
            );
        }

        UUID meetingId = request.getMeetingId();
        UUID processingJobId = request.getProcessingJobId();

        if (meetingId == null || processingJobId == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TRANSCRIPT_REQUEST",
                    "Meeting ID và Processing Job ID không được để trống"
            );
        }

        // Kiểm tra Meeting tồn tại
        if (!meetingRepository.existsById(meetingId)) {
            throw new BusinessException(
                    HttpStatus.NOT_FOUND,
                    "MEETING_NOT_FOUND",
                    "Meeting không tồn tại"
            );
        }

        // Khóa Job để tránh nhiều request cùng ghi dữ liệu một Job
        Job job = jobRepository.findByIdForUpdate(processingJobId)
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "JOB_NOT_FOUND",
                        "Processing Job không tồn tại"
                ));

        // Kiểm tra Job thuộc đúng Meeting
        if (!job.getMeetingId().equals(meetingId)) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "JOB_MEETING_MISMATCH",
                    "Processing Job không thuộc Meeting được yêu cầu"
            );
        }

        List<TranscriptItemRequest> items = request.getTranscripts();

        if (items == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TRANSCRIPT_LIST",
                    "Danh sách Transcript không được null"
            );
        }

        // Kiểm tra dữ liệu từng câu thoại
        for (TranscriptItemRequest item : items) {
            validateTranscriptItem(item);
        }

        // Thu thập các Speaker ID
        Set<UUID> speakerIds = new HashSet<>();

        for (TranscriptItemRequest item : items) {
            speakerIds.add(item.getSpeakerId());
        }

        // Tìm Speaker trong Database
        List<SpeakerSegment> speakers =
                speakerSegmentRepository.findAllById(speakerIds);

        if (speakers.size() != speakerIds.size()) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "SPEAKER_NOT_FOUND",
                    "Một hoặc nhiều Speaker không tồn tại"
            );
        }

        // Kiểm tra Speaker thuộc đúng Meeting
        for (SpeakerSegment speaker : speakers) {
            if (!meetingId.equals(speaker.getMeetingId())) {
                throw new BusinessException(
                        HttpStatus.BAD_REQUEST,
                        "SPEAKER_MEETING_MISMATCH",
                        "Speaker không thuộc Meeting được yêu cầu"
                );
            }
        }

        // Xóa Transcript cũ thuộc Job hiện tại để xử lý ASR retry
        List<Transcript> oldTranscripts =
                transcriptRepository
                        .findByProcessingJobIdOrderByStartTimeMsAsc(processingJobId);

        if (!oldTranscripts.isEmpty()) {
            transcriptRepository.deleteAll(oldTranscripts);
        }

        // Không tạo bản ghi nếu ASR trả về danh sách rỗng
        if (items.isEmpty()) {
            return new ArrayList<>();
        }

        // Chuyển Request DTO thành Transcript Entity
        List<Transcript> transcripts = new ArrayList<>();

        for (TranscriptItemRequest item : items) {

            Transcript transcript = Transcript.builder()
                    .meetingId(meetingId)
                    .processingJobId(processingJobId)
                    .speakerId(item.getSpeakerId())
                    .startTimeMs(item.getStartTimeMs())
                    .endTimeMs(item.getEndTimeMs())
                    .textContent(item.getTextContent().trim())
                    .confidenceScore(item.getConfidenceScore())
                    .build();

            transcripts.add(transcript);
        }

        // Sắp xếp câu thoại theo thời gian bắt đầu
        transcripts.sort(
                Comparator.comparing(Transcript::getStartTimeMs)
        );

        // Lưu hàng loạt vào PostgreSQL
        List<Transcript> savedTranscripts =
                transcriptRepository.saveAll(transcripts);

        // Chuyển Entity thành Response DTO
        return savedTranscripts.stream()
                .sorted(Comparator.comparing(Transcript::getStartTimeMs))
                .map(this::mapToResponse)
                .toList();
    }
    private void validateTranscriptItem(TranscriptItemRequest item) {

        if (item == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TRANSCRIPT_ITEM",
                    "Transcript item không được null"
            );
        }

        if (item.getSpeakerId() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "SPEAKER_ID_REQUIRED",
                    "Speaker ID không được để trống"
            );
        }

        if (item.getTextContent() == null
                || item.getTextContent().isBlank()) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "TRANSCRIPT_TEXT_REQUIRED",
                    "Nội dung câu thoại không được để trống"
            );
        }

        Long startTime = item.getStartTimeMs();
        Long endTime = item.getEndTimeMs();

        if (startTime == null || endTime == null
                || startTime < 0 || endTime < startTime) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TRANSCRIPT_TIMESTAMP",
                    "Timestamp không hợp lệ"
            );
        }

        BigDecimal confidence = item.getConfidenceScore();

        if (confidence != null
                && (confidence.compareTo(BigDecimal.ZERO) < 0
                || confidence.compareTo(BigDecimal.ONE) > 0)) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_CONFIDENCE_SCORE",
                    "Confidence score phải nằm trong khoảng từ 0 đến 1"
            );
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<TranscriptResponse> getTranscriptsByMeeting(UUID meetingId) {

        if (meetingId == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "MEETING_ID_REQUIRED",
                    "Meeting ID không được để trống"
            );
        }

        if (!meetingRepository.existsById(meetingId)) {
            throw new BusinessException(
                    HttpStatus.NOT_FOUND,
                    "MEETING_NOT_FOUND",
                    "Meeting không tồn tại"
            );
        }

        return transcriptRepository
                .findByMeetingIdOrderByStartTimeMsAsc(meetingId)
                .stream()
                .map(this::mapToResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<TranscriptResponse> getTranscriptsByJob(UUID processingJobId) {

        if (processingJobId == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "JOB_ID_REQUIRED",
                    "Job ID không được để trống"
            );
        }

        if (!jobRepository.existsById(processingJobId)) {
            throw new BusinessException(
                    HttpStatus.NOT_FOUND,
                    "JOB_NOT_FOUND",
                    "Processing Job không tồn tại"
            );
        }

        return transcriptRepository
                .findByProcessingJobIdOrderByStartTimeMsAsc(processingJobId)
                .stream()
                .map(this::mapToResponse)
                .toList();
    }

     private TranscriptResponse mapToResponse(Transcript transcript) {

        return TranscriptResponse.builder()
                .id(transcript.getId())
                .meetingId(transcript.getMeetingId())
                .processingJobId(transcript.getProcessingJobId())
                .speakerId(transcript.getSpeakerId())
                .startTimeMs(transcript.getStartTimeMs())
                .endTimeMs(transcript.getEndTimeMs())
                .textContent(transcript.getTextContent())
                .confidenceScore(transcript.getConfidenceScore())
                .build();
    }

}
