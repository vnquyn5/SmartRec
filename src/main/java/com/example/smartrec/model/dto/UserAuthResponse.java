package com.example.smartrec.model.dto;

import java.util.UUID;

import lombok.Builder;
import lombok.Getter;

@Getter 
@Builder 
public class UserAuthResponse {
    private UUID id;
    private String email;
    private String fullName;
    private String avatarUrl;
    
}
