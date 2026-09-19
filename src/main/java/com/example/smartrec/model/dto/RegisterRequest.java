package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class RegisterRequest {
    @NotBlank(message = "email/phone không được để trống ")
    @Pattern(regexp = "(^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.com$)|(^0(3|5|7|8|9)[0-9]{8}$)", message = " email hoặc phone không đúng định dạng")
    private String email;

    @NotBlank(message = "password không được để trống ")
    @Size(min = 8, max = 16, message = "Password phải từ 8 đến 16 ký tự")
    @Pattern(regexp = "^(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).*$", message = "Password phải có ít nhất 1 chữ hoa và 1 ký tự đặc biệt")
    private String passWord;

    @NotBlank(message = " họ và tên không được để trống ")
    @Size(min = 3, max = 30, message = "Họ và tên phải từ 3 đến 30 ký tự")
    @Pattern(regexp = "^[\\p{L} ]+$", message = "Họ và tên không được chứa số hoặc ký tự đặc biệt")
    private String full_name;

}
