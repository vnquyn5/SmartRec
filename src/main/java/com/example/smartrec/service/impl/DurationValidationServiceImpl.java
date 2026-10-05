package com.example.smartrec.service.impl;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.smartrec.config.MediaProperties;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.DurationValidationService;
import com.example.smartrec.service.FfprobeService;

import lombok.AllArgsConstructor;
import lombok.RequiredArgsConstructor;

@Service     
@RequiredArgsConstructor 

public class DurationValidationServiceImpl implements DurationValidationService {
    private final FfprobeService ffprobeService;
    private final MediaProperties mediaProperties;


    @Override 
    public void validateDuration(String filePath){
        double durationSeconds = ffprobeService.getDuration(filePath);// goi ffprobeService de doc duration cua file
        long maxDurationSeconds = mediaProperties.getMaxDurationSeconds();// lay gioi han cua duration trong yml
        if(durationSeconds  >maxDurationSeconds){
             throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_FILE_TOO_LARGE", "Thời lượng media vượt quá giới hạn 4h");
        }
    }
}
