package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.example.smartrec.entity.User;
import com.example.smartrec.entity.WorkspaceMember;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.ChangePassWordRequest;
import com.example.smartrec.model.dto.UserProfileReponse;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.repository.WorkspaceMemberRepository;
import com.example.smartrec.service.UserService;

import lombok.RequiredArgsConstructor;


@Service
@RequiredArgsConstructor
public class UserServiceImpl implements UserService {
    private final UserRepository userRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    public UserProfileReponse getMyProfile() {
        Authentication authentication = SecurityContextHolder
                .getContext()
                .getAuthentication();

        String email = authentication.getName();

        User user = userRepository
                .findByEmailOrPhone(email, email)
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "USER_NOT_FOUND",
                        "Không tìm thấy người dùng"));
        WorkspaceMember member = workspaceMemberRepository
                .findByUserId(
                        user.getId())
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.FORBIDDEN,
                        "WORKSPACE_ACCESS_DENIED",
                        "Người dùng không thuộc workspace này"));

        String role = member.getRole();
        if (role == null || role.isBlank()) {
            role = "USER";
        }

        return UserProfileReponse.builder()
                                 .id(user.getId())
                                 .email(user.getEmail())
                                 .full_name(user.getFull_name())
                                 .role(role)
                                 .createdAt(user.getCreated_at())
                                 .build();
    }

        @Override
    public void changePassword(ChangePassWordRequest request){
         Authentication authentication =
                SecurityContextHolder
                        .getContext()
                        .getAuthentication();

        String email = authentication.getName();

        User user = userRepository
                .findByEmailOrPhone(email, email)
                .orElseThrow(() ->
                        new BusinessException(
                                HttpStatus.NOT_FOUND,
                                "USER_NOT_FOUND",
                                "Không tìm thấy người dùng"
                        ));
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

}
