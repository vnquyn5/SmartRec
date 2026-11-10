package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.dto.JobSnapshotDTO;

public interface JobProgressService {

     // Lấy trạng thái hiện tại của Job
    JobSnapshotDTO getSnapshot(UUID jobId);

    // Phát thông báo tiến độ Job
    void publishProgress(UUID jobId);
} 
