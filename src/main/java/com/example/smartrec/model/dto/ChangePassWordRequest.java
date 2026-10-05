package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class ChangePassWordRequest {

    @NotBlank(message = "Mật khẩu hiện tại không được để trống ")
    private String oldPassword;

    @NotBlank (message = "Mật khẩu mới không được để trống ")
    @Size(min = 8, max = 16, message = "Password mới phải từ 8 đến 16 ký tự")
    @Pattern (regexp = "^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).*$", message = "Password phải có chữ hoa, chữ thường, chữ số và ký tự đặc biệt")
    private String newPassword;


}
