package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data 
public class LoginRequest {
    @NotBlank(message = "Email/Phone không được để trống")
    @Pattern( regexp = "(^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.com$)|(^0(3|5|7|8|9)[0-9]{8}$)",message = "Email hoặc phone không đúng định dạng" )
    private String email;

    @NotBlank (message = "mật khẩu không đúng  ")
    private String passWord;
    
}
