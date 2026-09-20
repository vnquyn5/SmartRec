package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

@Getter 
@Builder 
@AllArgsConstructor 
public class UserProfileReponse {
    private UUID id;

    private String email;
    
    private String full_name;

    private String role;

    private Instant createdAt;
    
}
