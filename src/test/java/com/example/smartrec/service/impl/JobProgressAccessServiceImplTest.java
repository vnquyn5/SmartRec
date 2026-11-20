package com.example.smartrec.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;

@ExtendWith(MockitoExtension.class)
// Kiểm tra ranh giới quyền đọc tiến độ theo chủ sở hữu meeting và job tương ứng.
class JobProgressAccessServiceImplTest {
    @Mock private JobRepository jobRepository;
    @Mock private MeetingRepository meetingRepository;
    @Mock private UserRepository userRepository;
    @InjectMocks private JobProgressAccessServiceImpl service;

    private UUID jobId;
    private UUID meetingId;
    private UUID ownerId;
    private User owner;

    @BeforeEach
    void setUp() {
        jobId = UUID.randomUUID();
        meetingId = UUID.randomUUID();
        ownerId = UUID.randomUUID();
        owner = User.builder().id(ownerId).email("owner@example.com").build();
        org.mockito.Mockito.lenient().when(userRepository.findByEmail("owner@example.com")).thenReturn(Optional.of(owner));
        org.mockito.Mockito.lenient().when(jobRepository.findById(jobId)).thenReturn(Optional.of(Job.builder()
                .id(jobId).meetingId(meetingId).build()));
        org.mockito.Mockito.lenient().when(meetingRepository.findById(meetingId)).thenReturn(Optional.of(Meeting.builder()
                .id(meetingId).workspace_id(ownerId).build()));
    }

    // Chủ meeting được đọc job thuộc meeting đó.
    @Test
    void meetingOwnerCanReadMatchingJob() {
        assertDoesNotThrow(() -> service.assertCanReadJob(meetingId, jobId, "owner@example.com"));
    }

    // Người dùng khác bị từ chối với mã lỗi quyền truy cập nhất quán.
    @Test
    void anotherUserCannotReadTheMeetingJob() {
        when(userRepository.findByEmail("other@example.com"))
                .thenReturn(Optional.of(User.builder().id(UUID.randomUUID()).email("other@example.com").build()));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.assertCanReadJob(jobId, "other@example.com"));

        assertEquals(HttpStatus.FORBIDDEN, exception.getStatus());
        assertEquals("MEETING_ACCESS_DENIED", exception.getCode());
    }

    // Hai chủ meeting chỉ đọc được job trong meeting của mình.
    @Test
    void twoUsersCanReadOnlyJobsFromTheirOwnMeetings() {
        UUID secondOwnerId = UUID.randomUUID();
        UUID secondMeetingId = UUID.randomUUID();
        UUID secondJobId = UUID.randomUUID();
        when(userRepository.findByEmail("second@example.com"))
                .thenReturn(Optional.of(User.builder().id(secondOwnerId).email("second@example.com").build()));
        when(jobRepository.findById(secondJobId)).thenReturn(Optional.of(Job.builder()
                .id(secondJobId).meetingId(secondMeetingId).build()));
        when(meetingRepository.findById(secondMeetingId)).thenReturn(Optional.of(Meeting.builder()
                .id(secondMeetingId).workspace_id(secondOwnerId).build()));

        assertDoesNotThrow(() -> service.assertCanReadJob(meetingId, jobId, "owner@example.com"));
        assertDoesNotThrow(() -> service.assertCanReadJob(secondMeetingId, secondJobId, "second@example.com"));
        assertThrows(BusinessException.class, () -> service.assertCanReadJob(secondJobId, "owner@example.com"));
        assertThrows(BusinessException.class, () -> service.assertCanReadJob(jobId, "second@example.com"));
    }

    // Cặp meeting/job không khớp được trả về như không tồn tại.
    @Test
    void aMismatchedMeetingAndJobPairIsHiddenAsNotFound() {
        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.assertCanReadJob(UUID.randomUUID(), jobId, "owner@example.com"));

        assertEquals(HttpStatus.NOT_FOUND, exception.getStatus());
        assertEquals("JOB_NOT_FOUND", exception.getCode());
    }
}
