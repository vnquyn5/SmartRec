package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.Locale;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.ChangePassWordRequest;
import com.example.smartrec.model.dto.UpdateUserProfileRequest;
import com.example.smartrec.model.dto.UserProfileReponse;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.UserService;
import com.example.smartrec.service.JwtService;
import com.example.smartrec.service.RefreshTokenService;
import com.example.smartrec.entity.RefreshToken;

import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserServiceImpl implements UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokenService;

    @Override
    public UserProfileReponse getMyProfile() {
        User user = getCurrentUser();
        return mapToProfileResponse(user);
    }

    @Override
    @Transactional
    public UserProfileReponse updateMyProfile(UpdateUserProfileRequest request) {

        User user = getCurrentUser();

        String newFullName = request.getFullName() == null
                ? user.getFull_name()
                : request.getFullName().trim();

        boolean googleAccount = isGoogleAccount(user);
        String requestedEmail = request.getEmail() == null ? null : request.getEmail().trim();
        if (googleAccount && requestedEmail != null && !requestedEmail.isBlank()
                && !requestedEmail.equalsIgnoreCase(user.getEmail())) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "GOOGLE_EMAIL_IMMUTABLE",
                    "Tài khoản đăng nhập bằng Google không thể thay đổi email.");
        }
        String newEmail = googleAccount || requestedEmail == null
                ? user.getEmail()
                : requestedEmail.toLowerCase(Locale.ROOT);

        String newPhone = request.getPhone() == null
                ? user.getPhone()
                : request.getPhone().trim();

        if (newFullName == null || newFullName.isBlank()) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FULL_NAME",
                    "Họ và tên không được để trống"
            );
        }

        if (newFullName.length() > 50
                || !newFullName.matches("^[\\p{L} ]+$")) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FULL_NAME",
                    "Họ và tên không hợp lệ"
            );
        }

        if (newEmail == null
                || !newEmail.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_EMAIL",
                    "Email không hợp lệ"
            );
        }

        if (newPhone == null
                || !newPhone.matches("^0[0-9]{9}$")) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_PHONE",
                    "Số điện thoại không hợp lệ"
            );
        }

        boolean emailChanged = user.getEmail() == null || !newEmail.equalsIgnoreCase(user.getEmail());
        if (emailChanged && userRepository.existsByEmailIgnoreCase(newEmail)) {

            throw new BusinessException(
                    HttpStatus.CONFLICT,
                    "EMAIL_ALREADY_EXISTS",
                    "Email đã tồn tại trên tài khoản khác"
            );
        }

        if (!newPhone.equals(user.getPhone())
                && userRepository.existsByPhone(newPhone)) {

            throw new BusinessException(
                    HttpStatus.CONFLICT,
                    "PHONE_ALREADY_EXISTS",
                    "Số điện thoại đã tồn tại trên tài khoản khác"
            );
        }

        RefreshToken previousRefreshToken = null;
        if (emailChanged && request.getRefreshToken() != null && !request.getRefreshToken().isBlank()) {
            try {
                previousRefreshToken = refreshTokenService.verify(request.getRefreshToken());
                if (!user.getId().equals(previousRefreshToken.getUser())) {
                    throw new BusinessException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN",
                            "Refresh token không thuộc phiên đăng nhập hiện tại.");
                }
            } catch (BusinessException invalidRefreshToken) {
                if ("INVALID_REFRESH_TOKEN".equals(invalidRefreshToken.getCode())) throw invalidRefreshToken;
                previousRefreshToken = null;
            }
        }

        user.setFull_name(newFullName);
        if (!googleAccount && emailChanged) user.setEmail(newEmail);
        user.setPhone(newPhone);
        user.setUpdated_at(Instant.now());

        userRepository.save(user);

        UserProfileReponse response = mapToProfileResponse(user);
        if (emailChanged) {
            if (previousRefreshToken != null) refreshTokenService.revoke(previousRefreshToken);
            response = UserProfileReponse.builder()
                    .id(response.getId()).userCode(response.getUserCode()).email(response.getEmail())
                    .authProvider(response.getAuthProvider()).phone(response.getPhone()).full_name(response.getFull_name())
                    .department(response.getDepartment()).position(response.getPosition()).role(response.getRole())
                    .createdAt(response.getCreatedAt()).accessToken(jwtService.generateToken(user))
                    .refreshToken(refreshTokenService.create(user).getToken()).build();
        }
        return response;
    }

    @Override
    public void changePassword(ChangePassWordRequest request) {

        User user = getCurrentUser();

        if (user.getPassword_hash() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "PASSWORD_NOT_SET",
                    "Tài khoản chưa thiết lập mật khẩu"
            );
        }

        if (!passwordEncoder.matches(
                request.getOldPassword(),
                user.getPassword_hash())) {

            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_CURRENT_PASSWORD",
                    "Mật khẩu hiện tại không chính xác"
            );
        }

        if (passwordEncoder.matches(
                request.getNewPassword(),
                user.getPassword_hash())) {

            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "SAME_PASSWORD",
                    "Mật khẩu mới không được trùng mật khẩu hiện tại"
            );
        }

        user.setPassword_hash(
                passwordEncoder.encode(request.getNewPassword())
        );

        user.setToken_version(
                user.getToken_version() + 1
        );

        user.setUpdated_at(Instant.now());

        userRepository.save(user);
    }

    private User getCurrentUser() {

        Authentication authentication =
                SecurityContextHolder
                        .getContext()
                        .getAuthentication();

        if (authentication == null
                || !authentication.isAuthenticated()
                || authentication.getName() == null) {

            throw new BusinessException(
                    HttpStatus.UNAUTHORIZED,
                    "UNAUTHORIZED",
                    "Yêu cầu đăng nhập"
            );
        }

        String identifier = authentication.getName();

        return userRepository
                .findByEmailOrPhone(identifier, identifier)
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "USER_NOT_FOUND",
                        "Không tìm thấy người dùng"
                ));
    }

    private UserProfileReponse mapToProfileResponse(User user) {

        return UserProfileReponse.builder()
                .id(user.getId())
                .userCode(user.getUserCode())
                .email(user.getEmail())
                .authProvider(isGoogleAccount(user) ? "GOOGLE" : "LOCAL")
                .phone(user.getPhone())
                .full_name(user.getFull_name())
                .department(user.getDepartment())
                .position(user.getPosition())
                .role("USER")
                .createdAt(user.getCreated_at())
                .build();
    }

    private boolean isGoogleAccount(User user) {
        return "GOOGLE".equalsIgnoreCase(user.getAuth_provider())
                || (user.getProvider_id() != null && !user.getProvider_id().isBlank());
    }
}
