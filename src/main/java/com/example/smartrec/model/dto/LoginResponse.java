package com.example.smartrec.model.dto;


import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import java.util.UUID;

@Getter
@Builder
@AllArgsConstructor
public class LoginResponse {
    private String message;

    private String accessToken;

    private UUID userId;

    private String email;

    private String fullName;
    
}
