package com.example.smartrec.service.impl;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ThreadLocalRandom;

import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.example.smartrec.entity.RefreshToken;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AuthResponse;
import com.example.smartrec.model.dto.GoogleLoginRequest;
import com.example.smartrec.model.dto.LoginRequest;
import com.example.smartrec.model.dto.LoginResponse;
import com.example.smartrec.model.dto.RefreshTokenRequest;
import com.example.smartrec.model.dto.RegisterRequest;
import com.example.smartrec.model.dto.UserAuthResponse;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.AuthService;
import com.example.smartrec.service.GoogleTokenService;
import com.example.smartrec.service.JwtService;
import com.example.smartrec.service.RefreshTokenService;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final GoogleTokenService googleTokenService;
    private final RefreshTokenService refreshTokenService;

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

        String userCode = generateUniqueUserCode();

        User user = User.builder()
                .userCode(userCode)
                .full_name(request.getFull_name())
                .email(request.getEmail())
                .phone(request.getPhone())
                .password_hash(passwordEncoder.encode(request.getPassWord()))
                .is_active(true)
                .build();
        userRepository.save(user);

    }

    private String generateUniqueUserCode() {
        String datePart = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        String code;
        do {
            String suffix = String.format("%04d", ThreadLocalRandom.current().nextInt(10000));
            code = "SMR" + datePart + suffix;
        } while (userRepository.existsByUserCode(code));
        return code;
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

        if (user.getPassword_hash() == null || !passwordEncoder.matches(
                request.getPassWord(),
                user.getPassword_hash())) {
            throw new BadCredentialsException("INVALID_CREDENTIALS");
        }
        String accessToken = jwtService.generateToken(user);
        RefreshToken refreshToken = refreshTokenService.create(user);

        // 5. Trả kết quả đăng nhập
        return LoginResponse.builder()
                .message("Đăng nhập thành công")
                .accessToken(accessToken)
                .refreshToken(refreshToken.getToken())
                .userId(user.getId())
                .email(user.getEmail())
                .fullName(user.getFull_name())
                .build();

    }

    @Override
    public AuthResponse googleLogin(GoogleLoginRequest request) {
        GoogleIdToken.Payload payload = googleTokenService.verify(request.getIdToken());
        String googleId = payload.getSubject();
        String email = payload.getEmail();

        String fullName = (String) payload.get("name");
        String avatarUrl = (String) payload.get("picture");
         if (fullName == null || fullName.isBlank()) {
            fullName = email;
        }

        User user = userRepository
                .findByEmail(email)
                .orElse(null);

        if (user == null) {

            user = User.builder()
                    .email(email)
                    .full_name(fullName)
                    .phone(null)
                    .password_hash(null)
                    .auth_provider("GOOGLE")
                    .provider_id(googleId)
                    .avatar_url(avatarUrl)
                    .is_active(true)
                    .build();

            user = userRepository.save(user);
        }else{
             if (!Boolean.TRUE.equals(user.getIs_active())) {
                throw new BusinessException(
                        HttpStatus.FORBIDDEN,
                        "ACCOUNT_LOCKED",
                        "Tài khoản đã bị khóa");
            }
            if (user.getProvider_id() != null
                    && !user.getProvider_id().equals(googleId)) {

                throw new BusinessException(
                        HttpStatus.CONFLICT,
                        "GOOGLE_ACCOUNT_MISMATCH",
                        "Tài khoản đã liên kết với Google account khác");
            }
            if (user.getProvider_id() == null) {
                user.setProvider_id(googleId);
            }
            if (avatarUrl != null && !avatarUrl.isBlank()) {
                user.setAvatar_url(avatarUrl);
            }

            user = userRepository.save(user);
            
        }
         String accessToken = jwtService.generateToken(user);
         RefreshToken refreshToken = refreshTokenService.create(user);
         return AuthResponse.builder()
        .message("Đăng nhập Google thành công")
        .status("SUCCESS")
        .accessToken(accessToken)
        .refreshToken(refreshToken.getToken())
        .tokenType("Bearer")
        .expiresIn(86400)
        .user(
                UserAuthResponse.builder()
                        .id(user.getId())
                        .email(user.getEmail())
                        .fullName(user.getFull_name())
                        .avatarUrl(user.getAvatar_url())
                        .build()
        )
        .build();
    }

    @Override
    public AuthResponse refreshToken(RefreshTokenRequest request){
        String oldToken = request.getRefreshToken();// lay refresh token cu tu request
        RefreshToken oldRefreshToken = refreshTokenService.verify(oldToken);
        User user = userRepository
                .findById(oldRefreshToken.getUser())
                .orElseThrow(() ->
                        new BusinessException(
                                HttpStatus.UNAUTHORIZED,
                                "INVALID_REFRESH_TOKEN",
                                "Refresh Token không hợp lệ"));

         if (!Boolean.TRUE.equals(user.getIs_active())) {
            throw new BusinessException(
                    HttpStatus.FORBIDDEN,
                    "ACCOUNT_LOCKED",
                    "Tài khoản đã bị khóa");
        }
        String accessToken = jwtService.generateToken(user);
        RefreshToken newRefreshToken = refreshTokenService.rotate(oldToken);
        return AuthResponse.builder()
        .message("Refresh token thành công")
        .status("SUCCESS")
        .accessToken(accessToken)
        .refreshToken(newRefreshToken.getToken())
        .tokenType("Bearer")
        .expiresIn(86400)
        .user(
                UserAuthResponse.builder()
                        .id(user.getId())
                        .email(user.getEmail())
                        .fullName(user.getFull_name())
                        .avatarUrl(user.getAvatar_url())
                        .build()
        )
        .build();
    }

}
