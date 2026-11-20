package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.enums.JobEventType;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.model.dto.JobSnapshotDTO;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobStageRepository;
import com.example.smartrec.service.JobProgressService;

import lombok.RequiredArgsConstructor;

/**
 * Tạo snapshot đọc lại và domain event từ trạng thái Job/JobStage trong cơ sở dữ liệu.
 * Sequence được lưu trên Job để client so sánh event đến muộn hoặc lấy snapshot sau reconnect.
 */
@Service
@RequiredArgsConstructor
public class JobProgressServiceImpl implements JobProgressService {
    /** Nguồn trạng thái tổng thể của Job và nơi lưu sequence event mới nhất. */
    private final JobRepository jobRepository;

    /** Nguồn trạng thái từng stage dùng để tính progress stage-level. */
    private final JobStageRepository jobStageRepository;

    /** Công bố event nội bộ trong transaction; listener sẽ gửi ra broker sau commit. */
    private final ApplicationEventPublisher eventPublisher;

    /**
     * Dựng snapshot đồng bộ từ Job và các stage đã lưu.
     * Snapshot gồm sequence cuối cùng để client xác định các event mới hơn cần áp dụng sau đó.
     */
    @Override
    @Transactional(readOnly = true)
    public JobSnapshotDTO getSnapshot(UUID jobId) {
        Job job = jobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND", "job không tìm thấy"));
        // Stage status là nguồn tính phần trăm; không suy ra progress chỉ từ currentStage.
        List<JobStage> stages = jobStageRepository.findByJobIdOrderByStageAsc(jobId);
        int progress = calculateProgress(job, stages);
        return new JobSnapshotDTO(
                job.getId(),
                job.getMeetingId(),
                job.getStatus().name(),
                job.getCurrentStage() != null
                        ? job.getCurrentStage().name()
                        : null,
                progress,
                job.getEventSequence(),
                job.getUpdatedAt());
    }

    /**
     * Tăng sequence, lưu lại trên Job rồi tạo domain event trong transaction hiện tại.
     *
     * <p>Event chỉ là thông báo nội bộ ở bước này. {@link TransactionalEventListener} chuyển nó
     * sang WebSocket sau commit, để client không nhận trạng thái mà transaction sau đó rollback.</p>
     *
     * @param jobId Job vừa có thay đổi cần phản ánh cho client
     */
    @Override
    @Transactional
    public void publishProgress(UUID jobId) {
        Job job = jobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND", "job không tìm thấy"));
        // Dùng cùng snapshot dữ liệu stage để sequence, status và phần trăm thuộc một lần đọc.
        List<JobStage> stages = jobStageRepository.findByJobIdOrderByStageAsc(jobId);
        Long currentSequence = job.getEventSequence() == null ? 0L : job.getEventSequence();

        // Sequence bắt đầu từ 1; nếu DB cũ chưa có giá trị thì xem sequence trước đó là 0.
        job.setEventSequence(currentSequence + 1);
        jobRepository.save(job);

        // Payload WebSocket được tạo từ trạng thái Job hiện tại, không lấy trạng thái từ request client.
        JobProgressEventReponse event = new JobProgressEventReponse();
        event.setEventType(resolveEventType(job.getStatus()));
        // Version cho phép client nhận biết schema payload nếu format event được mở rộng sau này.
        event.setVersion("1");
        event.setJobId(job.getId());
        event.setMeetingId(job.getMeetingId());
        // UUID nhận diện event; sequence mới là thứ tự ổn định theo từng Job.
        event.setEventId(UUID.randomUUID());
        event.setSequence(job.getEventSequence());
        // Timestamp hỗ trợ log/hiển thị; không dùng thay sequence để xác định thứ tự.
        event.setTimestamp(Instant.now());
        event.setCurrentStage(
                job.getCurrentStage() != null
                        ? job.getCurrentStage().name()
                        : null);
        event.setStatus(job.getStatus().name());
        // Tính từ các stage đã đọc ở trên để snapshot và event dùng cùng một quy tắc progress.
        event.setProgressPercent(calculateProgress(job, stages));
        eventPublisher.publishEvent(event);
    }

    /**
     * Progress stage-level = số stage SUCCESS / tổng số stage, làm tròn đến phần trăm nguyên.
     * Job COMPLETED luôn trả 100%; Job chưa có stage trả 0%.
     */
    private int calculateProgress(Job job, List<JobStage> stages) {

        // Trạng thái tổng thể COMPLETED là kết luận cuối cùng, kể cả dữ liệu stage rỗng.
        if (job.getStatus() == JobStatus.COMPLETED) {
            return 100;
        }

        if (stages == null || stages.isEmpty()) {
            return 0;
        }

        long completedStages = stages.stream()
                .filter(stage -> stage.getStatus() == JobStageStatus.SUCCESS)
                .count();

        return (int) Math.round(
                completedStages * 100.0 / stages.size());
    }

    /** Event terminal phân biệt hoàn tất/thất bại; trạng thái trung gian đều dùng JOB_PROGRESS. */
    private String resolveEventType(JobStatus status) {

        if (status == JobStatus.COMPLETED) {
            return JobEventType.JOB_COMPLETED.name();
        }

        if (status == JobStatus.FAILED || status == JobStatus.DLQ) {
            return JobEventType.JOB_FAILED.name();
        }

        return JobEventType.JOB_PROGRESS.name();
    }
}
