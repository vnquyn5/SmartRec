package com.example.smartrec.service;

import com.example.smartrec.model.dto.ChunkUploadRequest;
import com.example.smartrec.model.dto.ChunkUploadResponse;
import com.example.smartrec.model.dto.MergeUploadReponse;
import com.example.smartrec.model.dto.MergeUploadRequest;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;

public interface UploadService {
    UploadInitResponse initUpload(UploadInitRequest request);

    ChunkUploadResponse uploadChunk(ChunkUploadRequest request);

    MergeUploadReponse mergeUpload(MergeUploadRequest request);

    void pauseUpload(String uploadSessionId);

    void resumeUpload(String uploadSessionId);

    void cancelUpload(String uploadSessionId);

}
