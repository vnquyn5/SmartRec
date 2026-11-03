package com.example.smartrec.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Configuration
@ConfigurationProperties(prefix = "smartrec.ai-engine")
public class AIEngineConfig {

    private String baseUrl;

    private String generatePath;

    private String internalToken;

    private int connectTimeout = 5000;

    private int readTimeout = 120000;

    @Bean
    public RestTemplate aiEngineRestTemplate(
            RestTemplateBuilder builder) {

        return builder
                .setConnectTimeout(
                        Duration.ofMillis(connectTimeout))
                .setReadTimeout(
                        Duration.ofMillis(readTimeout))
                .build();
    }
}