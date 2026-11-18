package com.example.smartrec.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import com.example.smartrec.security.JobProgressChannelInterceptor;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    private final JobProgressChannelInterceptor jobProgressChannelInterceptor;

    public WebSocketConfig(JobProgressChannelInterceptor jobProgressChannelInterceptor) {
        this.jobProgressChannelInterceptor = jobProgressChannelInterceptor;
    }
    @Value("${websocket.application-prefix:/app}")
    private String applicationPrefix;

    @Value("${websocket.broker-prefix:/topic}")
    private String brokerPrefix;

    @Value("${websocket.endpoint:/ws}")
    private String endpoint;

    @Value("${websocket.allowed-origins[0]:http://localhost:3000}")
    private String origin1;

    @Value("${websocket.allowed-origins[1]:http://localhost:5173}")
    private String origin2;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {

        // Backend gửi event đến các topic
        config.enableSimpleBroker(brokerPrefix);

        // Prefix dành cho message từ client gửi lên Backend
        config.setApplicationDestinationPrefixes(applicationPrefix);
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(jobProgressChannelInterceptor);
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {

        // Endpoint kết nối WebSocket
        registry.addEndpoint(endpoint)
                .setAllowedOriginPatterns(origin1, origin2);
    }

}
