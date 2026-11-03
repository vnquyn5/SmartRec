package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.dto.TranscriptRequest;
import com.example.smartrec.model.dto.TranscriptResponse;

public interface TranscriptService {
    List<TranscriptResponse> saveTranscript(TranscriptRequest request);// luu list cau thoai tu ket qua ASR
    List<TranscriptResponse> getTranscriptsByMeeting(UUID meetingId);// lay ban ghi theo cuoc hop
    List<TranscriptResponse> getTranscriptsByJob(UUID processingJobId); // lay list ban ghii theo AI job
    
} 