package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import com.example.smartrec.entity.User;
import com.example.smartrec.model.dto.MeetingFilterRequest;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.MeetingServiceImpl;

@ExtendWith(MockitoExtension.class)
class MeetingListProjectionTest {
    @Mock private MeetingRepository meetingRepository;
    @Mock private MediaFileRepository mediaFileRepository;
    @Mock private UserRepository userRepository;
    @Mock private MinioService minioService;
    @InjectMocks private MeetingServiceImpl meetingService;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken("alice@example.com", null, List.of(() -> "USER")));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void returnsRepositoryProjectionWithoutLoadingMediaPerMeeting() {
        UUID userId = UUID.randomUUID();
        MeetingResponseDTO row = new MeetingResponseDTO(
                UUID.randomUUID(), "Weekly sync", null, UUID.randomUUID(), "weekly.mp3",
                "audio/mpeg", 1024L, 60, null, null, null);
        when(userRepository.findByEmail("alice@example.com"))
                .thenReturn(Optional.of(User.builder().id(userId).email("alice@example.com").build()));
        when(meetingRepository.searchMeetings(eq(userId), eq(null), eq(null), any()))
                .thenReturn(new PageImpl<>(List.of(row), PageRequest.of(0, 20, Sort.by(Sort.Direction.DESC, "created_at")), 1));

        var response = meetingService.findMeetings(new MeetingFilterRequest());

        assertSame(row, response.getContent().get(0));
        verify(mediaFileRepository, never()).findById(any());
    }
}
