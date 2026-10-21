package com.example.smartrec.config;


import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Validated
@ConfigurationProperties(prefix = "smartrec.ai-stt")
public class AiSttProperties {
    @NotBlank(message = "smartrec.ai-stt.base-url không được để trống")
    private String baseUrl;

    @NotBlank(message = "smartrec.ai-stt.transcribe-path không được để trống")
    private String transcribePath;

    @NotBlank(message = "smartrec.ai-stt.model-name không được để trống")
    private String modelName;

    @NotBlank(message = "smartrec.ai-stt.model-version không được để trống")
    private String modelVersion;
}
