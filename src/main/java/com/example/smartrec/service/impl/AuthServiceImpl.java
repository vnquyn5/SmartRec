package com.example.smartrec.service.impl;

import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.LoginRequest;
import com.example.smartrec.model.dto.LoginResponse;
import com.example.smartrec.model.dto.RegisterRequest;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.AuthService;
import com.example.smartrec.service.JwtService; 

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
     private final JwtService jwtService;

    @Override
    public void register(RegisterRequest request) {
        if (userRepository.findByEmail(request.getEmail()).isPresent()) {
            throw new BusinessException(
                    HttpStatus.CONFLICT,
                    "EMAIL_ALREADY_EXISTS",
                    "Email đã tồn tại");
        }
        if (userRepository.findByPhone(request.getPhone()).isPresent()) {
            throw new BusinessException(
                    HttpStatus.CONFLICT,
                    "PHONE_ALREADY_EXISTS",
                    "Số điện thoại đã tồn tại");
        }

        User user = User.builder()

                .full_name(request.getFull_name())
                .email(request.getEmail())
                .phone(request.getPhone())
                .password_hash(passwordEncoder.encode(request.getPassWord()))
                .is_active(true)
                .build();
        userRepository.save(user);

    }

    @Override
    public LoginResponse login(LoginRequest request) {
        String identifier = request.getEmail();
        User user = userRepository
            .findByEmailOrPhone(identifier, identifier)
            .orElseThrow(() -> new BadCredentialsException("INVALID_CREDENTIALS"));

        if (!user.getIs_active()) {
            throw new BusinessException(HttpStatus.FORBIDDEN, "ACCOUNT_LOCKED", "tài khoản đã bị khóa");
        }

        if (!passwordEncoder.matches(
                request.getPassWord(),
                user.getPassword_hash())) {
            throw new BadCredentialsException("INVALID_CREDENTIALS");
        }
         String accessToken = jwtService.generateToken(user);

        // 5. Trả kết quả đăng nhập
        return LoginResponse.builder()
                .message("Đăng nhập thành công")
                .accessToken(accessToken)
                .userId(user.getId())
                .email(user.getEmail())
                .fullName(user.getFull_name())
                .build();

    }
}
