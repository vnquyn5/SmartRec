package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.dto.SlideOCRResponse;

public interface SlideOCRService {
    List<SlideOCRResponse> getMeetingSlides(UUID meetingId);
} 
