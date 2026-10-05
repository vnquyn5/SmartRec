package com.example.smartrec.service.impl;

import java.time.Instant;

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

import lombok.RequiredArgsConstructor;


@Service
@RequiredArgsConstructor
public class UserServiceImpl implements UserService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    public UserProfileReponse getMyProfile() {
        User user = getCurrentUser();
        return mapToProfileResponse(user);
    }

    @Override
    public UserProfileReponse updateMyProfile(UpdateUserProfileRequest request) {
        User user = getCurrentUser();

        String newFullName = request.getFullName() == null ? user.getFull_name() : request.getFullName().trim();
        String newEmail = request.getEmail() == null ? user.getEmail() : request.getEmail().trim();
        String newPhone = request.getPhone() == null ? user.getPhone() : request.getPhone().trim();

        if (newFullName.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_FULL_NAME", "Họ và tên không được để trống");
        }
        if (newFullName.length() > 50 || !newFullName.matches("^[\\p{L} ]+$")) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_FULL_NAME", "Họ và tên không hợp lệ");
        }
        if (!newEmail.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_EMAIL", "Email không hợp lệ");
        }
        if (!newPhone.matches("^0[0-9]{9}$")) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_PHONE", "Số điện thoại không hợp lệ");
        }

        if (!newEmail.equalsIgnoreCase(user.getEmail()) && userRepository.existsByEmail(newEmail)) {
            throw new BusinessException(HttpStatus.CONFLICT, "EMAIL_ALREADY_EXISTS", "Email đã tồn tại trên tài khoản khác");
        }

        if (!newPhone.equals(user.getPhone()) && userRepository.existsByPhone(newPhone)) {
            throw new BusinessException(HttpStatus.CONFLICT, "PHONE_ALREADY_EXISTS", "Số điện thoại đã tồn tại trên tài khoản khác");
        }

        user.setFull_name(newFullName);
        user.setEmail(newEmail);
        user.setPhone(newPhone);
        user.setUpdated_at(Instant.now());
        userRepository.save(user);

        return mapToProfileResponse(user);
    }

    @Override
    public void changePassword(ChangePassWordRequest request){
        User user = getCurrentUser();

        if(!passwordEncoder.matches(request.getOldPassword(), user.getPassword_hash())){
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_CURRENT_PASSWORD", "Mật khẩu hiện tại không chính xác");
        }
        if(passwordEncoder.matches(request.getNewPassword(), user.getPassword_hash())){
            throw new BusinessException(HttpStatus.BAD_REQUEST, "SAME_PASSWORD", "Mật khẩu mới không được trùng mật khẩu hiện tại");
        }
        user.setPassword_hash(passwordEncoder.encode(request.getNewPassword()));

        user.setUpdated_at(Instant.now());
        userRepository.save(user);
    }

    private User getCurrentUser() {
        Authentication authentication = SecurityContextHolder
                .getContext()
                .getAuthentication();

        if (authentication == null || authentication.getName() == null) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập");
        }

        String identifier = authentication.getName();
        return userRepository
                .findByEmailOrPhone(identifier, identifier)
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "USER_NOT_FOUND",
                        "Không tìm thấy người dùng"));
    }

    private UserProfileReponse mapToProfileResponse(User user) {
        return UserProfileReponse.builder()
                .id(user.getId())
                .userCode(user.getUserCode())
                .email(user.getEmail())
                .phone(user.getPhone())
                .full_name(user.getFull_name())
                .department(user.getDepartment())
                .position(user.getPosition())
                .role("USER")
                .createdAt(user.getCreated_at())
                .build();
    }

}
