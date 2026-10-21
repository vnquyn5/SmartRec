package com.example.smartrec.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Getter;
import lombok.Setter;

@ConfigurationProperties(prefix = "smartrec")
@Getter
@Setter
public class SttProperties {

    private AiEngine aiEngine = new AiEngine();
    private Stt stt = new Stt();

    @Getter 
    @Setter 
    public static class AiEngine {
        private String baseUrl;
        private String internalToken;
    }

    @Getter 
    @Setter 
    public static class Stt {
        private String requestPath = "/api/v1/stt";
        private String defaultModel = "default-stt";
        private String defaultLanguage = "vi";
    }
}