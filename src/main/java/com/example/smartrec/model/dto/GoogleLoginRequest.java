package com.example.smartrec.model.dto;

import com.google.auto.value.AutoValue.Builder;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter 
@Setter 
@Builder 
public class GoogleLoginRequest {

    @NotBlank (message = "idToken không được để trống")
    private String idToken;
    
}
