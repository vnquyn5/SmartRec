package com.example.smartrec.service.impl;

import org.springframework.stereotype.Service;

import com.example.smartrec.entity.Job;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.CreateJobRequest;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.JobQueueService;
import com.example.smartrec.service.JobService;

import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;

import lombok.RequiredArgsConstructor;

@Service 
@RequiredArgsConstructor 
public class JobServiceImpl implements JobService {
    private final JobRepository jobRepository;
    private final JobQueueService jobQueueService;
    @Value("${job.max-retry:5}") // doc cau hinh trong yml
    private int maxRetry;

    @Override 
    @Transactional 
    public JobResponse createJob(CreateJobRequest request){

        if (request == null || request.getMediaFileId() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_REQUEST",
                    "mediaFileId không được để trống"
            );
        }

        Job job = Job.builder()
                     .mediaFileId(request.getMediaFileId())
                     .status(JobStatus.QUEUED)
                     .retryCount(0)
                     .build();

        job = jobRepository.save(job);

        // dua job vao redis
        jobQueueService.enqueueJob(job.getId());// lay job id vua tao sau do dua job vao main queue cua redis
        return toResponse(job);
    }

    @Override 
    @Transactional(readOnly = true)
    public JobResponse getJob(UUID jobId){
        Job job = findJob(jobId);
        return toResponse(job);
    }

    @Override 
    @Transactional(readOnly = true)
    public List<JobResponse>getDLQJob(){                          // chuyen doi 1 doi tuong entity thanh 1 doi tuong response de tra ve cho client
        return jobRepository.findByStatus(JobStatus.DLQ).stream().map(this::toResponse).toList();

    }

    @Override 
    @Transactional 
    public void processJob(UUID jobId){
        Job job = findJob(jobId);
        if(job.getStatus() == JobStatus.DLQ){ // Kiem tra job hien tai co phai la DLQ khong
             System.out.println("Job đang ở DLQ, không tự động retry: "+ job.getId());
            return;
        }

        if(job.getStatus() == JobStatus.COMPLETED){
             System.out.println("Job đã COMPLETED: "+ job.getId());
            return ;
        }

        // chuyen sang run
        job.setStatus(JobStatus.RUNNING);
        jobRepository.save(job);
        // xu li media
        try {
            processMedia(job);
        } catch (Exception e) {
            handleProcessingFailure(job, e);
            return;
        }
        job.setStatus(JobStatus.COMPLETED);
        job.setErrorCode(null);
        job.setErrorMessage(null);
        job.setFailedAt(null);
        jobRepository.save(job);
    }

    @Override 
    @Transactional 
    public void  manualRetry(UUID jobId){
        Job job = findJob(jobId);

        // chi co DLQ moi duoc retry thu cong
        if(job.getStatus() != JobStatus.DLQ){
            throw new BusinessException(HttpStatus.BAD_REQUEST,"INVALID_JOB_STATUS", "Chỉ Job ở trạng thái DLQ mới được retry thủ công");
        }
        job.setRetryCount(0);
        // dua job tro lai thu lai
        job.setStatus(JobStatus.RETRYING);
        job.setLastRetryAt(Instant.now());
        jobRepository.save(job);

        // dua lai trang thai retry queue
        jobQueueService.enqueueRetry(job.getId());
         System.out.println("Manual retry Job: "+ job.getId());
    }


    private void processMedia(Job job){
        System.out.println("xu ly cong viec"+job.getId());
        throw new RuntimeException("AI service unavailable");
    }

    private void handleProcessingFailure(Job job,Exception e){
        job.setStatus(JobStatus.FAILED);
        job.setErrorCode("PROCESSING_ERROR");// luu ma loi
        String errorMessage = e.getMessage();
        if(errorMessage == null || errorMessage.isBlank()){
            errorMessage = e.getClass().getSimpleName();
        }
        job.setErrorMessage(errorMessage);

        // luu thoi diem loi
        job.setFailedAt(Instant.now());
        jobRepository.save(job);

        // kiem tra retry
        if(job.getRetryCount() < maxRetry){
            retryJob(job);
        }else{
            moveToDLQ(job);
        }
    }

    private void retryJob(Job job){
        int nextRetry = job.getRetryCount()+1;
        job.setRetryCount(nextRetry);
        job.setStatus(JobStatus.RETRYING);
        job.setLastRetryAt(Instant.now());// luu thoi gian retry
        jobRepository.save(job);
        jobQueueService.enqueueRetry(job.getId());// dua job nay vao retry queue
        System.out.println("Retry Job: "+job.getId()+" attempt "+nextRetry+"/"+maxRetry);
    }

    private void moveToDLQ(Job job){
        job.setStatus(JobStatus.DLQ);// chuyen status thanh DLq
        jobRepository.save(job);
        jobQueueService.enqueueDLQ(job.getId());// dua job id vao DQL redis
        System.out.println("Công việc đã di chuyển đến DLQ"+job.getId());
    }

    private Job findJob(UUID jobId){
         if (jobId == null) {

            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_JOB_ID",
                    "jobId không được để trống"
            );
        }
        return jobRepository.findById(jobId)
        .orElseThrow(() -> new BusinessException(
                                HttpStatus.NOT_FOUND,
                                "JOB_NOT_FOUND",
                                "Không tìm thấy Job: " + jobId
                        )
                );
    }
     private JobResponse toResponse(Job job) {

        return JobResponse.builder()
                .id(job.getId())
                .mediaFileId(job.getMediaFileId())
                .status(job.getStatus())
                .retryCount(job.getRetryCount())
                .errorCode(job.getErrorCode())
                .errorMessage(job.getErrorMessage())
                .failedAt(job.getFailedAt())
                .lastRetryAt(job.getLastRetryAt())
                .createdAt(job.getCreatedAt())
                .updatedAt(job.getUpdatedAt())
                .build();
    }

}
