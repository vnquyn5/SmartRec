package com.example.smartrec.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import com.example.smartrec.security.JobProgressChannelInterceptor;

import lombok.RequiredArgsConstructor;

@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    // Gắn interceptor vào inbound channel để mọi frame client đi qua cùng một điểm xác thực/allowlist.
    private final JobProgressChannelInterceptor jobProgressChannelInterceptor;

    /** Prefix của lệnh client gửi tới @MessageMapping; mặc định là /app. */
    @Value("${websocket.application-prefix:/app}")
    private String applicationPrefix;

    /** Prefix topic server phát event; mặc định là /topic. */
    @Value("${websocket.broker-prefix:/topic}")
    private String brokerPrefix;

    /** HTTP handshake endpoint mà client dùng để mở WebSocket, mặc định /ws. */
    @Value("${websocket.endpoint:/ws}")
    private String endpoint;

    /** Origin frontend thứ nhất được phép mở handshake. */
    @Value("${websocket.allowed-origins[0]:http://localhost:3000}")
    private String origin1;

    /** Origin frontend thứ hai được phép mở handshake. */
    @Value("${websocket.allowed-origins[1]:http://localhost:5173}")
    private String origin2;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // /topic/jobs/{jobId} phát sự kiện cập nhật; /queue được dùng cho phản hồi riêng theo user.
        // Simple broker phục vụ cả hai prefix trong cấu hình hiện tại, không tạo destination ghi từ client.
        config.enableSimpleBroker(brokerPrefix, "/queue");

        // Client gửi request snapshot tới /app/ai-progress để Spring định tuyến vào @MessageMapping.
        config.setApplicationDestinationPrefixes(applicationPrefix);
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Endpoint HTTP để bắt đầu WebSocket; các origin lấy từ cấu hình app thay vì hard-code ở đây.
        registry.addEndpoint(endpoint)
                .setAllowedOriginPatterns(origin1, origin2);
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // CONNECT xác thực phiên, SEND giới hạn vào request snapshot, SUBSCRIBE kiểm tra destination/quyền Job.
        registration.interceptors(jobProgressChannelInterceptor);
    }

}
