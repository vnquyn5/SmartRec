package com.example.smartrec.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import jakarta.persistence.EntityManager;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingAuditLogRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.MeetingAuditLogServiceImpl;

@ExtendWith(MockitoExtension.class)
class MeetingAuditLogServiceImplTest {
    private static final String PRINCIPAL = "reviewer@example.invalid";

    @Mock MeetingService meetings;
    @Mock UserRepository users;
    @Mock JobRepository jobs;
    @Mock SummaryRepository summaries;
    @Mock ActionItemRepository items;
    @Mock MeetingAuditLogRepository audits;
    @Mock EntityManager entityManager;
    @Mock Summary summary;
    @Mock Runnable saveReview;
    @InjectMocks MeetingAuditLogServiceImpl service;

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void invalidInputNeverCallsSaveOrRepositories() {
        assertThatThrownBy(() -> service.auditReviewSave(null, UUID.randomUUID(), Set.of(), saveReview))
                .isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getCode()).isEqualTo("VALIDATION_ERROR"));
        verifyNoInteractions(meetings, users, jobs, summaries, items, audits, saveReview);
    }

    @Test
    void unchangedSummaryReturnsSaveResultWithoutWritingAnAudit() {
        UUID meetingId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(PRINCIPAL, null, List.of()));
        when(users.findByEmail(PRINCIPAL)).thenReturn(Optional.of(User.builder().id(UUID.randomUUID()).build()));
        when(jobs.findByIdForUpdate(jobId)).thenReturn(Optional.of(Job.builder().meetingId(meetingId).build()));
        when(summaries.findByProcessingJobId(jobId)).thenReturn(Optional.of(summary));
        when(summary.getId()).thenReturn(UUID.randomUUID());
        when(summary.getMeetingId()).thenReturn(meetingId);
        when(summary.getExecutiveSummary()).thenReturn("Same stored text");
        service.auditReviewSave(meetingId, jobId, Set.of(), saveReview);
        verify(saveReview).run();
        verify(audits, never()).saveAll(anyList());
    }
}
