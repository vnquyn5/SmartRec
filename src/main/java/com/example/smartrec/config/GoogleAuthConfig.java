package com.example.smartrec.config;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Collections;


@Configuration
public class GoogleAuthConfig {
     @Value("${google.client-id}")
    private String googleClientId;

    @Bean
    public GoogleIdTokenVerifier googleIdTokenVerifier()
            throws Exception {

        return new GoogleIdTokenVerifier.Builder(
                GoogleNetHttpTransport.newTrustedTransport(),
                GsonFactory.getDefaultInstance()
        )
        .setAudience(
                Collections.singletonList(googleClientId)
        )
        .build();
    }
}
