package com.example.smartrec.model.dto;


import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Setter;

@Getter 
@Setter 
@Builder 
@NoArgsConstructor 
@AllArgsConstructor 
public class GoogleLoginRequest {

    @NotBlank (message = "idToken không được để trống")
    private String idToken;
    
}
