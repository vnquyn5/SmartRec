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
    @Transactional 
    public ContextPayloadReponse createContext(UUID meetingId){
        List<MeetingSlide> slides = meetingSlideRepository.findByMeetingIdOrderByTimestampMsAsc(meetingId);
        // sap theo slide theo thoi gian 
        slides.sort(Comparator.comparing(MeetingSlide::getTimestampMs,Comparator.nullsLast(Long::compareTo)));
        // khoi tao context items
        List<ContextItemDTO> contextItem = new ArrayList<>();
        // lay ds transcrips theo meeting va sap xep thoi gian tang gian
        List<Transcript> transcripts=transcriptRepository.findByMeetingIdOrderByStartTimeMsAsc(meetingId);
        if(slides.isEmpty()){
            throw new BusinessException(HttpStatus.NOT_FOUND, "DATA_OCR_NOT_FOUND", "Không tìm thấy data OCR của cuộc họp");
        }
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
