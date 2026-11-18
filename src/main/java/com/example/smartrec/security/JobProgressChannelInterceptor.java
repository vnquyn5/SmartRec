package com.example.smartrec.security;

import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;

import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;

import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class JobProgressChannelInterceptor implements ChannelInterceptor {
    private final JwtService jwtService;
    private final UserRepository userRepository;
    private final JobRepository jobRepository;
    private final MeetingRepository meetingRepository;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);
        if (accessor == null || accessor.getCommand() == null) return message;

        if (accessor.getCommand() == StompCommand.CONNECT) {
            authenticateConnect(accessor);
            return MessageBuilder.createMessage(message.getPayload(), accessor.getMessageHeaders());
        } else if (accessor.getCommand() == StompCommand.SUBSCRIBE) {
            authorizeSubscription(accessor);
        } else if (accessor.getCommand() == StompCommand.SEND) {
            throw new AccessDeniedException("Client messages are not accepted");
        }
        return message;
    }

    private void authenticateConnect(StompHeaderAccessor accessor) {
        try {
            String authorization = accessor.getFirstNativeHeader(HttpHeaders.AUTHORIZATION);
            if (authorization == null || !authorization.startsWith("Bearer ")) deny();
            Claims claims = jwtService.parseClaims(authorization.substring("Bearer ".length()));
            if (!"access".equals(claims.get("type", String.class))) deny();
            String subject = claims.getSubject();
            var user = userRepository.findByEmail(subject).or(() -> userRepository.findByPhone(subject))
                    .orElseThrow(() -> new AccessDeniedException("Invalid WebSocket credentials"));
            if (!user.getId().toString().equals(claims.get("userId", String.class))
                    || jwtService.extractTokenVersion(claims) != user.getToken_version()) deny();
            accessor.setUser(new UsernamePasswordAuthenticationToken(
                    user.getId().toString(), null, java.util.List.of(new SimpleGrantedAuthority("ROLE_USER"))));
        } catch (RuntimeException error) {
            throw new AccessDeniedException("Invalid WebSocket credentials");
        }
    }

    private void authorizeSubscription(StompHeaderAccessor accessor) {
        var principal = accessor.getUser();
        String destination = accessor.getDestination();
        if (principal == null || destination == null || !destination.matches("/topic/jobs/[0-9a-fA-F-]{36}")) {
            deny();
        }
        try {
            UUID jobId = UUID.fromString(destination.substring("/topic/jobs/".length()));
            var job = jobRepository.findById(jobId)
                    .orElseThrow(() -> new AccessDeniedException("Job subscription denied"));
            var meeting = meetingRepository.findById(job.getMeetingId())
                    .orElseThrow(() -> new AccessDeniedException("Job subscription denied"));
            if (!principal.getName().equals(meeting.getWorkspace_id().toString())) deny();
        } catch (RuntimeException error) {
            throw new AccessDeniedException("Job subscription denied");
        }
    }

    private static void deny() {
        throw new AccessDeniedException("WebSocket access denied");
    }
}
