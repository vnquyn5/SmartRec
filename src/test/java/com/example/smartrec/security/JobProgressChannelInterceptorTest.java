package com.example.smartrec.security;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.Message;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.entity.User;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.JobProgressAccessService;

import io.jsonwebtoken.Claims;

@ExtendWith(MockitoExtension.class)
// Bao phủ xác thực CONNECT và các luật cho phép/từ chối frame STOMP.
class JobProgressChannelInterceptorTest {
    @Mock private JwtService jwtService;
    @Mock private UserRepository userRepository;
    @Mock private JobProgressAccessService jobProgressAccessService;
    @InjectMocks private JobProgressChannelInterceptor interceptor;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(interceptor, "applicationPrefix", "/app");
        ReflectionTestUtils.setField(interceptor, "brokerPrefix", "/topic");
    }

    // JWT hợp lệ được đổi thành Principal để các frame tiếp theo dùng danh tính này.
    @Test
    void connectAuthenticatesBearerTokenAndBindsPrincipal() {
        Claims claims = org.mockito.Mockito.mock(Claims.class);
        when(claims.getSubject()).thenReturn("reader@example.com");
        when(jwtService.parseClaims("valid-token")).thenReturn(claims);
        when(jwtService.extractTokenVersion(claims)).thenReturn(3L);
        when(jwtService.extractRoles(claims)).thenReturn(List.of("ROLE_USER"));
        when(userRepository.findByEmail("reader@example.com"))
                .thenReturn(Optional.of(User.builder().email("reader@example.com").token_version(3L).build()));
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.CONNECT);
        accessor.addNativeHeader("Authorization", "Bearer valid-token");
        Message<byte[]> message = frame(accessor);

        Message<?> authenticatedMessage = interceptor.preSend(message, null);

        StompHeaderAccessor authenticatedAccessor = MessageHeaderAccessor.getAccessor(
                authenticatedMessage, StompHeaderAccessor.class);
        assertNotNull(authenticatedAccessor);
        assertNotNull(authenticatedAccessor.getUser());
        org.junit.jupiter.api.Assertions.assertEquals("reader@example.com", authenticatedAccessor.getUser().getName());
    }

    // Chỉ subscribe đúng topic của job sau khi service xác nhận quyền đọc.
    @Test
    void exactJobTopicRequiresAndChecksAuthenticatedPrincipal() {
        UUID jobId = UUID.randomUUID();
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setDestination("/topic/jobs/" + jobId);
        accessor.setUser(new UsernamePasswordAuthenticationToken("reader@example.com", null, List.of()));
        Message<byte[]> message = frame(accessor);

        assertSame(message, interceptor.preSend(message, null));
        verify(jobProgressAccessService).assertCanReadJob(jobId, "reader@example.com");
    }

    // Lỗi quyền từ service phải chặn subscribe trước khi frame tới broker.
    @Test
    void unauthorizedJobSubscriptionIsRejected() {
        UUID jobId = UUID.randomUUID();
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setDestination("/topic/jobs/" + jobId);
        accessor.setUser(new UsernamePasswordAuthenticationToken("other@example.com", null, List.of()));
        doThrow(new AccessDeniedException("denied")).when(jobProgressAccessService)
                .assertCanReadJob(jobId, "other@example.com");

        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(frame(accessor), null));
    }

    // Queue phản hồi riêng của user được phép để nhận snapshot qua request STOMP.
    @Test
    void privateProgressReplyQueueIsAllowed() {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setDestination("/user/queue/ai-progress");
        accessor.setUser(new UsernamePasswordAuthenticationToken("reader@example.com", null, List.of()));
        Message<byte[]> message = frame(accessor);
        assertSame(message, interceptor.preSend(message, null));
    }

    // Không cho wildcard subscribe hoặc client tự gửi dữ liệu vào topic broadcast.
    @Test
    void wildcardSubscriptionAndClientPublishToTopicAreRejected() {
        StompHeaderAccessor subscribe = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        subscribe.setDestination("/topic/jobs/*");
        subscribe.setUser(new UsernamePasswordAuthenticationToken("reader@example.com", null, List.of()));
        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(frame(subscribe), null));

        StompHeaderAccessor send = StompHeaderAccessor.create(StompCommand.SEND);
        send.setDestination("/topic/jobs/" + UUID.randomUUID());
        send.setUser(new UsernamePasswordAuthenticationToken("reader@example.com", null, List.of()));
        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(frame(send), null));
    }

    // Không chấp nhận CONNECT thiếu bearer token.
    @Test
    void unauthenticatedConnectIsRejected() {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.CONNECT);
        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(frame(accessor), null));
    }

    private Message<byte[]> frame(StompHeaderAccessor accessor) {
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}
