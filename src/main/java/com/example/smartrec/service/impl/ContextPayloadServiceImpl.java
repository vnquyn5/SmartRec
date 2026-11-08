package com.example.smartrec.service.impl;



import java.util.ArrayList;

import java.util.Comparator;

import java.util.HashMap;

import java.util.List;

import java.util.Map;

import java.util.UUID;



import org.springframework.http.HttpStatus;

import org.springframework.stereotype.Service;

import org.springframework.transaction.annotation.Transactional;



import com.example.smartrec.entity.ContextPayload;

import com.example.smartrec.entity.MeetingSlide;

import com.example.smartrec.entity.Transcript;

import com.example.smartrec.exception.BusinessException;

import com.example.smartrec.model.ContextItemDTO;

import com.example.smartrec.model.dto.ContextPayloadReponse;

import com.example.smartrec.repository.ContextPayloadRepository;

import com.example.smartrec.repository.MeetingSlideRepository;

import com.example.smartrec.repository.TranscriptRepository;

import com.example.smartrec.service.ContextPayloadService;



import lombok.RequiredArgsConstructor;





@Service

@RequiredArgsConstructor

public class ContextPayloadServiceImpl implements ContextPayloadService {

    private final ContextPayloadRepository contextPayloadRepository;

    private final MeetingSlideRepository meetingSlideRepository;

    private final TranscriptRepository transcriptRepository;



    @Override
    @Transactional(readOnly = true)
    public com.example.smartrec.model.dto.JobContext createJobContext(
            UUID meetingId, UUID jobId, boolean includeOcr) {
        if (meetingId == null || jobId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "CONTEXT_ID_REQUIRED", "Thiếu meetingId/jobId");
        }
        var transcripts = transcriptRepository.findByProcessingJobIdOrderByStartTimeMsAsc(jobId);
        if (transcripts.isEmpty()) {
            throw new BusinessException(HttpStatus.NOT_FOUND,
                    "DATA_TRANSCRIPT_NOT_FOUND", "Job chưa có transcript");
        }
        var evidence = new ArrayList<com.example.smartrec.model.dto.JobContext.Evidence>();
        for (var transcript : transcripts) {
            if (!meetingId.equals(transcript.getMeetingId()) || !jobId.equals(transcript.getProcessingJobId())
                    || transcript.getId() == null || transcript.getStartTimeMs() == null
                    || transcript.getEndTimeMs() == null
                    || transcript.getStartTimeMs() < 0 || transcript.getEndTimeMs() < transcript.getStartTimeMs()
                    || transcript.getTextContent() == null || transcript.getTextContent().isBlank()) {
                throw new BusinessException(HttpStatus.CONFLICT,
                        "CONTEXT_INVALID_SOURCE", "Transcript không có provenance hợp lệ cho Job");
            }
            evidence.add(new com.example.smartrec.model.dto.JobContext.Evidence(
                    "TRANSCRIPT", transcript.getId(), transcript.getSpeakerId(),
                    transcript.getStartTimeMs(), transcript.getEndTimeMs(), transcript.getTextContent()));
        }
        // Audio-only contexts do not query OCR storage.
        if (includeOcr) {
            for (var slide : meetingSlideRepository.findByMeetingIdAndJobIdOrderByTimestampMsAsc(meetingId, jobId)) {
                if (!meetingId.equals(slide.getMeetingId()) || !jobId.equals(slide.getJobId())
                        || slide.getSlideId() == null || slide.getTimestampMs() == null || slide.getTimestampMs() < 0) {
                    throw new BusinessException(HttpStatus.CONFLICT,
                            "CONTEXT_INVALID_SOURCE", "Slide không thuộc Job");
                }
                if (slide.getOcrText() != null && !slide.getOcrText().isBlank()) {
                    evidence.add(new com.example.smartrec.model.dto.JobContext.Evidence(
                            "SLIDE_OCR", slide.getSlideId(), null, slide.getTimestampMs(),
                            slide.getTimestampMs(), slide.getOcrText()));
                }
            }
        }
        evidence.sort(Comparator.comparing(com.example.smartrec.model.dto.JobContext.Evidence::startTimeMs)
                .thenComparing(item -> item.sourceId().toString()));
        return new com.example.smartrec.model.dto.JobContext(meetingId, jobId, List.copyOf(evidence));
    }

    @Override

    @Transactional

    public ContextPayloadReponse createContext(UUID meetingId){

        // Transcript is the primary source for meeting context.
        List<Transcript> transcripts =
                transcriptRepository.findByMeetingIdOrderByStartTimeMsAsc(meetingId);

        if (transcripts == null || transcripts.isEmpty()) {
            throw new BusinessException(
                    HttpStatus.NOT_FOUND,
                    "DATA_TRANSCRIPT_NOT_FOUND",
                    "Không tìm thấy transcript của cuộc họp");
        }

        List<ContextItemDTO> contextItem = new ArrayList<>();

        for (Transcript segment : transcripts) {
            if (segment == null
                    || segment.getTextContent() == null
                    || segment.getTextContent().isBlank()) {
                continue;
            }

            ContextItemDTO item = new ContextItemDTO();
            item.setStart(segment.getStartTimeMs());
            item.setEnd(segment.getEndTimeMs());
            item.setSpeaker(
                    segment.getSpeakerId() == null
                            ? null
                            : segment.getSpeakerId().toString());
            item.setTranscript(segment.getTextContent());

            contextItem.add(item);
        }

        if (contextItem.isEmpty()) {
            throw new BusinessException(
                    HttpStatus.NOT_FOUND,
                    "DATA_TRANSCRIPT_NOT_FOUND",
                    "Transcript không chứa nội dung lời thoại hợp lệ");
        }

        // OCR enriches context but is not required for audio-only meetings.
        List<MeetingSlide> slides =
                meetingSlideRepository.findByMeetingIdOrderByTimestampMsAsc(meetingId);

        if (slides != null) {
            for (MeetingSlide slide : slides) {
                if (slide == null
                        || slide.getOcrText() == null
                        || slide.getOcrText().isBlank()) {
                    continue;
                }

                ContextItemDTO item = new ContextItemDTO();
                item.setSlideText(slide.getOcrText());
                item.setSlideTimestamp(slide.getTimestampMs());

                contextItem.add(item);
            }
        }

        // Both transcript and slide timestamps are milliseconds.
        contextItem.sort(Comparator.comparingLong(
                (ContextItemDTO item) ->
                        item.getStart() != null
                                ? item.getStart()
                                : item.getSlideTimestamp() != null
                                        ? item.getSlideTimestamp()
                                        : Long.MAX_VALUE
        ));

        // chuyen DTO thanh map de luu Json

        Map<String,Object> payload= new HashMap<>();

        payload.put("meeting_id", meetingId.toString());

        List<Map<String,Object>> items= new ArrayList<>();

        for(ContextItemDTO item :contextItem){

            Map<String,Object>itemMap = new HashMap<>();

            itemMap.put("start", item.getStart());

            itemMap.put("end", item.getEnd());

            itemMap.put("speaker", item.getSpeaker());

            itemMap.put("transcript", item.getTranscript());

            itemMap.put("slide_text", item.getSlideText());

            itemMap.put("slide_timestamp", item.getSlideTimestamp());

            items.add(itemMap);

        }

        payload.put("context_items",items);

        // luu context payload neu khong co context payload thi tao moi

        ContextPayload entity = contextPayloadRepository.findByMeetingId(meetingId).orElseGet(ContextPayload::new);

        entity.setMeetingId(meetingId);

        entity.setPayload(payload);

        contextPayloadRepository.save(entity);

        return new  ContextPayloadReponse(meetingId,contextItem);

    }



    @Override

    @Transactional (readOnly = true)

    public ContextPayloadReponse getContext(UUID meetingId){

        ContextPayload entity = contextPayloadRepository.findByMeetingId(meetingId)

                                                        .orElseThrow(()-> new BusinessException(HttpStatus.NOT_FOUND, "CONTEXTPAYLOAD_NOT_FOUND", "Không tìm thấy Context Payload"));

        return  convertPayloadToDTO(entity);

    }

    @SuppressWarnings ("unchecked")

    private ContextPayloadReponse convertPayloadToDTO(ContextPayload entity){

        Map<String, Object> payload = entity.getPayload();// lay map json tu entity

        List<Map<String, Object>> items = (List<Map<String, Object>>) payload.get("context_items");

        List<ContextItemDTO> contextItems = new ArrayList<>();

        if(items!=null){

            for(Map<String,Object> item :items){

                ContextItemDTO dto = new ContextItemDTO();

                dto.setStart(toLong(item.get("start")));

                dto.setEnd(toLong(item.get("end")));

                dto.setSpeaker((String) item.get("speaker"));

                dto.setTranscript((String) item.get("transcript"));

                dto.setSlideText((String) item.get("slide_text"));

                dto.setSlideTimestamp(toLong(item.get("slide_timestamp")));

                contextItems.add(dto);

            }

        }

        return new ContextPayloadReponse(entity.getMeetingId(),contextItems);

    }

     private Long toLong(Object value) {



        if (value == null) {

            return null;

        }



        if (value instanceof Number number) {

            return number.longValue();

        }



        return Long.valueOf(value.toString());

    }





}
