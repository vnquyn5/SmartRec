package com.example.smartrec.security;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;

class JobProgressChannelInterceptorTest {
    private static final String SECRET = "404E635266556A586E3272357538782F413F4428472B4B6250645367566B5970";
    private final JwtService jwt = new JwtService(SECRET);
    private final UserRepository users = mock(UserRepository.class);
    private final JobRepository jobs = mock(JobRepository.class);
    private final MeetingRepository meetings = mock(MeetingRepository.class);
    private final JobProgressChannelInterceptor interceptor =
            new JobProgressChannelInterceptor(jwt, users, jobs, meetings);
    private final UUID userId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private final UUID meetingId = UUID.randomUUID();

    private String accessToken(String type) {
        return io.jsonwebtoken.Jwts.builder().setSubject("owner@example.com")
                .claim("type", type).claim("userId", userId.toString()).claim("tokenVersion", 0)
                .setIssuedAt(new Date()).setExpiration(Date.from(Instant.now().plusSeconds(300)))
                .signWith(io.jsonwebtoken.security.Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .compact();
    }

    private Message<byte[]> connect(String token) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.CONNECT);
        accessor.setNativeHeader("Authorization", "Bearer " + token);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    @Test
    void authenticatesOwnerWithAccessTokenAndRejectsGuestOrRefreshTokens() {
        User user = User.builder().id(userId).email("owner@example.com").token_version(0L).build();
        when(users.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        var authenticated = interceptor.preSend(connect(accessToken("access")), mock(org.springframework.messaging.MessageChannel.class));
        assertEquals(userId.toString(),
                StompHeaderAccessor.wrap(authenticated).getUser().getName());
        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(
                connect(accessToken("GUEST")), mock(org.springframework.messaging.MessageChannel.class)));
        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(
                connect(accessToken("refresh")), mock(org.springframework.messaging.MessageChannel.class)));
    }

    @Test
    void permitsOnlyMeetingOwnerToSubscribeToItsJobTopic() {
        Meeting meeting = Meeting.builder().id(meetingId).workspace_id(userId).build();
        Job job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build();
        when(jobs.findById(jobId)).thenReturn(Optional.of(job));
        when(meetings.findById(meetingId)).thenReturn(Optional.of(meeting));
        StompHeaderAccessor authorized = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        authorized.setDestination("/topic/jobs/" + jobId);
        authorized.setUser(new UsernamePasswordAuthenticationToken(userId.toString(), null, List.of()));
        assertNotNull(interceptor.preSend(
                MessageBuilder.createMessage(new byte[0], authorized.getMessageHeaders()),
                mock(org.springframework.messaging.MessageChannel.class)));

        StompHeaderAccessor unauthorized = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        unauthorized.setDestination("/topic/jobs/" + jobId);
        unauthorized.setUser(new UsernamePasswordAuthenticationToken(UUID.randomUUID().toString(), null, List.of()));
        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(
                MessageBuilder.createMessage(new byte[0], unauthorized.getMessageHeaders()),
                mock(org.springframework.messaging.MessageChannel.class)));
    }

    @Test
    void rejectsSubscribeWithoutAuthenticatedOwnerAndArbitraryBrokerDestination() {
        StompHeaderAccessor missingUser = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        missingUser.setDestination("/topic/jobs/" + jobId);
        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(
                MessageBuilder.createMessage(new byte[0], missingUser.getMessageHeaders()),
                mock(org.springframework.messaging.MessageChannel.class)));
        StompHeaderAccessor arbitrary = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        arbitrary.setDestination("/topic/admin");
        arbitrary.setUser(new UsernamePasswordAuthenticationToken(userId.toString(), null, List.of()));
        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(
                MessageBuilder.createMessage(new byte[0], arbitrary.getMessageHeaders()),
                mock(org.springframework.messaging.MessageChannel.class)));
    }
}
