package com.example.smartrec.model.dto;


import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Builder 
public class AuthResponse {
    private String message;
    private String status;

    private String accessToken;

    private String refreshToken;

    private String tokenType;

    private long expiresIn;

    private UserAuthResponse user;

}
