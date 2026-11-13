package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Request body cho bước verify; không nhận passcode qua URL để tránh lưu trong access log/history. */
public record VerifySharePasscodeRequest(
        @NotBlank @Size(max = 72) String passcode // Service tiếp tục kiểm tra và so khớp với BCrypt hash.
) {
}
