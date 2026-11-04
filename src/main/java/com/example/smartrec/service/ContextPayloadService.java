package com.example.smartrec.service;



import java.util.UUID;



import com.example.smartrec.model.ContextItemDTO;

import com.example.smartrec.model.dto.ContextPayloadReponse;



public interface ContextPayloadService {

    ContextPayloadReponse createContext(UUID meetingId);

    ContextPayloadReponse getContext(UUID meetingId);

    com.example.smartrec.model.dto.JobContext createJobContext(UUID meetingId, UUID jobId, boolean includeOcr);

}
