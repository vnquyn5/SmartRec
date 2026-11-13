package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.mockito.Mockito.lenient;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.PublicShareLink;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.ShareLinkStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.CreateShareLinkRequest;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.PublicShareLinkRepository;
import com.example.smartrec.repository.ShareLinkAuditRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.PublicShareLinkServiceImpl;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class PublicShareLinkServiceImplTest {
    // Mock DB/Redis/encoder để kiểm thử nghiệp vụ service mà không cần hạ tầng thật.
    @Mock MeetingRepository meetingRepository;
    @Mock MediaFileRepository mediaFileRepository;
    @Mock PublicShareLinkRepository shareLinkRepository;
    @Mock ShareLinkAuditRepository auditRepository;
    @Mock UserRepository userRepository;
    @Mock PasswordEncoder passwordEncoder;
    @Mock RedisTemplate<String, Object> redisTemplate;
    @Mock ValueOperations<String, Object> valueOperations;
    @InjectMocks PublicShareLinkServiceImpl service;

    private final UUID userId = UUID.randomUUID();
    private final UUID meetingId = UUID.randomUUID();
    private User user;

    @BeforeEach
    void setUp() {
        // Mô phỏng JWT đã xác thực; service đọc email từ SecurityContext để tải user.
        user = new User();
        user.setId(userId);
        user.setEmail("owner@example.com");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("owner@example.com", "", java.util.List.of()));
        lenient().when(userRepository.findByEmail("owner@example.com")).thenReturn(Optional.of(user));
        ReflectionTestUtils.setField(service, "contextPath", "/api/v1");
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
    }

    @AfterEach
    void clearContext() { SecurityContextHolder.clearContext(); }

    @Test
    void createStoresOnlyTokenHashAndAuditsCreation() {
        // Response phải có token gốc, còn entity chỉ lưu hash; thao tác tạo phải ghi audit.
        Meeting meeting = meeting(userId);
        when(meetingRepository.findById(meetingId)).thenReturn(Optional.of(meeting));
        when(shareLinkRepository.saveAndFlush(any(PublicShareLink.class))).thenAnswer(invocation -> {
            PublicShareLink link = invocation.getArgument(0);
            link.setId(UUID.randomUUID());
            link.setCreatedAt(Instant.now());
            link.setUpdatedAt(Instant.now());
            return link;
        });
        when(passwordEncoder.encode("1234")).thenReturn("bcrypt-value");

        var response = service.create(meetingId, new CreateShareLinkRequest(null, "1234"));

        assertNotNull(response.token());
        assertEquals("/api/v1/public/share/" + response.token(), response.url());
        assertTrue(response.shareLink().hasPasscode());
        verify(shareLinkRepository).saveAndFlush(argThat(link ->
                !link.getTokenHash().equals(response.token())
                        && link.getTokenHash().equals(sha256(response.token()))
                        && "bcrypt-value".equals(link.getPasscodeHash())));
        verify(auditRepository).save(argThat(audit -> "CREATE".equals(audit.getAction().name())));
    }

    @Test
    void nonOwnerCannotCreateShareLink() {
        // User khác owner phải bị từ chối trước khi có lệnh insert link.
        when(meetingRepository.findById(meetingId)).thenReturn(Optional.of(meeting(UUID.randomUUID())));

        BusinessException error = assertThrows(BusinessException.class,
                () -> service.create(meetingId, new CreateShareLinkRequest(null, null)));

        assertEquals("MEETING_ACCESS_DENIED", error.getCode());
        verify(shareLinkRepository, never()).saveAndFlush(any());
    }

    @Test
    void revokedLinkIsNotAvailableToGuest() {
        // Link REVOKED bị chặn trước khi service tải meeting.
        String token = "random-share-token";
        PublicShareLink link = new PublicShareLink();
        link.setTokenHash(sha256(token));
        link.setStatus(ShareLinkStatus.REVOKED);
        when(shareLinkRepository.findByTokenHash(sha256(token))).thenReturn(Optional.of(link));

        assertThrows(Exception.class, () -> service.access(token, null));
        verify(meetingRepository, never()).findById(any());
    }

    @Test
    void passcodeAttemptIsReservedBeforePasswordCheck() {
        String token = "random-share-token";
        PublicShareLink link = new PublicShareLink();
        link.setTokenHash(sha256(token));
        link.setMeetingId(meetingId);
        link.setPasscodeHash("bcrypt-value");
        link.setStatus(ShareLinkStatus.ACTIVE);
        when(shareLinkRepository.findByTokenHash(sha256(token))).thenReturn(Optional.of(link));
        Meeting sharedMeeting = meeting(userId);
        sharedMeeting.setMedia_file_id(UUID.randomUUID());
        when(meetingRepository.findById(meetingId)).thenReturn(Optional.of(sharedMeeting));
        MediaFile media = new MediaFile();
        when(mediaFileRepository.findById(any())).thenReturn(Optional.of(media));
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(any(String.class))).thenReturn(6L);

        BusinessException error = assertThrows(BusinessException.class,
                () -> service.verify(token, "1234"));

        assertEquals("SHARE_PASSCODE_RATE_LIMITED", error.getCode());
        verify(passwordEncoder, never()).matches(any(), any());
    }

    private Meeting meeting(UUID owner) {
        Meeting meeting = new Meeting();
        meeting.setId(meetingId);
        meeting.setWorkspace_id(owner);
        return meeting;
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) { throw new RuntimeException(ex); }
    }
}
