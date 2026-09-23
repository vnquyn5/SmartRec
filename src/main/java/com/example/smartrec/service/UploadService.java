package com.example.smartrec.service;

import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;



public interface UploadService {
    UploadInitResponse initUpload(UploadInitRequest request);

}
