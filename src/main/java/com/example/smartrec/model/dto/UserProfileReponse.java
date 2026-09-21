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

    private String userCode;

    private String email;

    private String phone;

    private String full_name;

    private String department;

    private String position;

    private String role;

    private Instant createdAt;

}
