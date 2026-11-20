package com.example.smartrec.security;

import java.security.Principal;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;

import com.example.smartrec.entity.User;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.JobProgressAccessService;

import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;

/**
 * Áp dụng xác thực và allowlist cho frame STOMP đi từ client vào backend.
 *
 * <p>Client phải xác thực ở {@code CONNECT}. Sau đó client chỉ được gửi yêu cầu đọc snapshot tới
 * {@code /app/ai-progress}, đăng ký queue phản hồi riêng của mình, hoặc đăng ký topic của một Job
 * mà access service cho phép đọc. Mọi destination khác, gồm wildcard và lệnh gửi trực tiếp vào
 * topic broadcast, đều bị từ chối trước khi frame tới handler hoặc broker.</p>
 *
 * <p>Kiểm tra quyền cho payload đọc snapshot được thực hiện lại trong handler vì quyền subscribe
 * topic không thay thế cho việc kiểm tra cặp Meeting/Job được truyền trong request.</p>
 */
@Component
@RequiredArgsConstructor
public class JobProgressChannelInterceptor implements ChannelInterceptor {
    /** Cú pháp header mà STOMP CONNECT dùng để gửi access token. */
    private static final String BEARER_PREFIX = "Bearer ";

    /** Queue dùng cho snapshot trả riêng tới user; Spring sẽ định tuyến theo Principal. */
    private static final String PROGRESS_REPLY_DESTINATION = "/user/queue/ai-progress";

    /** UUID dạng chuẩn được chấp nhận trong destination /topic/jobs/{jobId}. */
    private static final String UUID_PATTERN =
            "([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";

    /** Dùng chung bộ xác thực token với các API HTTP hiện có. */
    private final JwtService jwtService;

    /** Đối chiếu tài khoản còn tồn tại và token version hiện hành. */
    private final UserRepository userRepository;

    /** Dùng chung chính sách quyền đọc Job với endpoint snapshot và WebSocket handler. */
    private final JobProgressAccessService jobProgressAccessService;

    /** Destination prefix phải khớp cấu hình message broker ở WebSocketConfig. */
    @Value("${websocket.application-prefix:/app}")
    private String applicationPrefix;

    /** Prefix topic phải khớp destination backend dùng khi publish event. */
    @Value("${websocket.broker-prefix:/topic}")
    private String brokerPrefix;

    /**
     * Kiểm tra từng frame STOMP inbound trước khi Spring chuyển nó tới controller hoặc broker.
     *
     * @param message frame nhận từ client
     * @param channel channel inbound của Spring Messaging
     * @return message gốc nếu được phép; riêng CONNECT được tạo lại để lưu Principal đã xác thực
     * @throws AccessDeniedException nếu danh tính thiếu/sai hoặc command/destination không nằm trong allowlist
     */
    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        // MessageHeaderAccessor của message có thể immutable; dùng mutable copy để gắn user cho CONNECT.
        MessageHeaderAccessor mutableAccessor = MessageHeaderAccessor.getMutableAccessor(message);

        // Interceptor có thể gặp message nội bộ không phải STOMP; không áp luật destination STOMP lên chúng.
        if (!(mutableAccessor instanceof StompHeaderAccessor accessor)) return message;

        // Frame điều khiển không có command không chứa yêu cầu ứng dụng cần kiểm tra ở đây.
        if (accessor.getCommand() == null) return message;

        StompCommand command = accessor.getCommand();
        if (command == StompCommand.CONNECT) {
            // Xác thực một lần lúc mở phiên STOMP; Spring giữ Principal này cho các frame cùng phiên.
            accessor.setUser(authenticate(accessor));
            return MessageBuilder.createMessage(message.getPayload(), accessor.getMessageHeaders());
        }

        // Đây là lệnh dọn phiên, không truy cập dữ liệu Job; luôn cho phép client đóng phiên/hủy subscription.
        if (command == StompCommand.DISCONNECT || command == StompCommand.UNSUBSCRIBE) return message;

        // CONNECT đã gắn Authentication vào session; mọi lệnh ứng dụng khác bắt buộc dùng danh tính đó.
        Authentication authentication = requireAuthenticatedUser(accessor.getUser());
        String destination = accessor.getDestination();

        if (command == StompCommand.SEND) {
            // SEND duy nhất được phép gọi handler đọc snapshot. Handler sẽ kiểm tra quyền trên meetingId/jobId.
            // Không cho client SEND tới /topic hay destination khác để giả mạo event do backend phát.
            if (!(applicationPrefix + "/ai-progress").equals(destination)) {
                throw new AccessDeniedException("Client SEND destination is not allowed");
            }
            return message;
        }

        if (command == StompCommand.SUBSCRIBE) {
            // User destination được Spring chuyển thành queue riêng cho Principal hiện tại.
            // Quyền đọc snapshot vẫn được kiểm tra trong handler trước khi phản hồi được gửi vào queue này.
            if (PROGRESS_REPLY_DESTINATION.equals(destination)) return message;

            // Chỉ nhận topic có đúng một UUID; regex neo hai đầu loại wildcard, suffix và topic tổng quát.
            Pattern topicPattern = Pattern.compile("^" + Pattern.quote(brokerPrefix + "/jobs/")
                    + UUID_PATTERN + "$");
            Matcher matcher = destination == null ? null : topicPattern.matcher(destination);
            if (matcher == null || !matcher.matches()) {
                throw new AccessDeniedException("STOMP subscription destination is not allowed");
            }
            try {
                // Topic chỉ mang jobId; access service xác nhận Job tồn tại và user sở hữu Meeting liên quan.
                jobProgressAccessService.assertCanReadJob(UUID.fromString(matcher.group(1)), authentication.getName());
            } catch (RuntimeException ex) {
                // Không để lộ qua STOMP việc Job không tồn tại hay user không có quyền đọc Job đó.
                throw new AccessDeniedException("Job progress access denied");
            }
            return message;
        }

        // ACK/NACK, BEGIN/SUBSCRIBE destination khác và các command không thuộc giao thức đọc progress bị chặn.
        throw new AccessDeniedException("STOMP command is not allowed");
    }

    /**
     * Tạo Authentication cho phiên STOMP từ bearer token hoặc Principal của HTTP handshake.
     *
     * <p>Nếu CONNECT có Authorization header thì token được xác minh lại và phải khớp token version
     * đang lưu trong user. Nếu không có header, chỉ tái sử dụng Principal đã xác thực ở handshake.</p>
     */
    private Authentication authenticate(StompHeaderAccessor accessor) {
        String authorization = firstHeader(accessor, "Authorization", "authorization");
        if (authorization != null) {
            // Header có mặt nhưng sai định dạng không được phép rơi xuống cơ chế handshake fallback.
            if (!authorization.startsWith(BEARER_PREFIX) || authorization.length() <= BEARER_PREFIX.length()) {
                throw new AccessDeniedException("Invalid STOMP credentials");
            }
            try {
                // parseClaims kiểm tra chữ ký/hạn dùng; token guest không được truy cập trạng thái Job riêng tư.
                Claims claims = jwtService.parseClaims(authorization.substring(BEARER_PREFIX.length()));
                if ("GUEST".equals(claims.get("type", String.class))) {
                    throw new AccessDeniedException("Guest sessions cannot read job progress");
                }

                // Subject của access token thường là email; user phải còn tồn tại để phiên được chấp nhận.
                String email = claims.getSubject();
                User user = userRepository.findByEmail(email)
                        .orElseThrow(() -> new AccessDeniedException("Invalid STOMP credentials"));

                // Đăng xuất/thu hồi token làm tokenVersion tăng; token cũ không thể mở session mới.
                if (jwtService.extractTokenVersion(claims) != user.getToken_version()) {
                    throw new AccessDeniedException("Invalid STOMP credentials");
                }

                // Giữ authorities trong Authentication để Principal của STOMP tương thích với security context.
                List<SimpleGrantedAuthority> authorities = jwtService.extractRoles(claims).stream()
                        .map(SimpleGrantedAuthority::new)
                        .toList();
                return new UsernamePasswordAuthenticationToken(email, null, authorities);
            } catch (AccessDeniedException ex) {
                throw ex;
            } catch (RuntimeException ex) {
                // Không trả chi tiết parse/JWT/database error về client kết nối STOMP.
                throw new AccessDeniedException("Invalid STOMP credentials");
            }
        }

        // Một số client xác thực HTTP handshake trước; khi CONNECT không gửi token thì dùng Principal đó.
        Principal handshakePrincipal = accessor.getUser();
        Authentication authentication = requireAuthenticatedUser(handshakePrincipal);

        // Principal hợp lệ phải ánh xạ được về user; hỗ trợ cả email và phone theo convention hiện tại.
        userRepository.findByEmail(authentication.getName())
                .or(() -> userRepository.findByPhone(authentication.getName()))
                .orElseThrow(() -> new AccessDeniedException("Invalid handshake principal"));
        return authentication;
    }

    /**
     * Chuyển Principal của session thành Authentication sau khi loại anonymous, rỗng hoặc chưa xác thực.
     *
     * @param principal user đã gắn với HTTP handshake hoặc STOMP session
     * @return Authentication hợp lệ để dùng cho các kiểm tra quyền phía sau
     */
    private Authentication requireAuthenticatedUser(Principal principal) {
        if (principal instanceof Authentication authentication && authentication.isAuthenticated()
                && authentication.getName() != null && !authentication.getName().isBlank()
                && !authentication.getName().equals("anonymousUser")) {
            return authentication;
        }
        throw new AccessDeniedException("STOMP authentication is required");
    }

    /** Đọc Authorization theo cả hai kiểu viết hoa phổ biến của STOMP client. */
    private String firstHeader(StompHeaderAccessor accessor, String first, String second) {
        String value = accessor.getFirstNativeHeader(first);
        return value == null ? accessor.getFirstNativeHeader(second) : value;
    }
}
