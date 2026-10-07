package com.example.smartrec.service.impl;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.smartrec.entity.RefreshToken;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.repository.RefreshTokenRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.JwtService;
import com.example.smartrec.service.RefreshTokenService;

import io.jsonwebtoken.JwtException;


import org.springframework.transaction.annotation.Transactional;


import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class RefreshTokenServiceImpl implements RefreshTokenService {
    private final RefreshTokenRepository refreshTokenRepository;
    private final UserRepository userRepository;
    private final JwtService jwtService;
    private static final long REFRESH_TOKEN_DAYS = 7;

    @Override
    @Transactional
    public RefreshToken create(User user) {
        String token = jwtService.generateRefreshToken(user);
        RefreshToken refreshToken = RefreshToken.builder()
                .user(user.getId())
                .token(token)
                .expiryDate(Instant.now().plus(REFRESH_TOKEN_DAYS, ChronoUnit.DAYS))
                .revoked(false)
                .createdAt(Instant.now())
                .build();
        return refreshTokenRepository.save(refreshToken);
    }

    @Override
    @Transactional(readOnly = true)
    public RefreshToken verify(String token) {
        // tim RefreshToken trong database dua tren gia tri token
        RefreshToken refreshToken = refreshTokenRepository.findByToken(token)
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "REFRESH_TOKEN_NOT_FOUND",
                        "Không tìm thấy Refresh token"));

        // kiem tra token da bi thu hoi chua
        if (refreshToken.isRevoked()) {
            throw new BusinessException(
                    HttpStatus.UNAUTHORIZED,
                    "REFRESH_TOKEN_REVOKED",
                    "Refresh token đã bị thu hồi");
        }

        // kiem tra token da het han chua
        if (refreshToken.getExpiryDate().isBefore(Instant.now())) {
            throw new BusinessException(
                    HttpStatus.UNAUTHORIZED,
                    "REFRESH_TOKEN_EXPIRED",
                    "Refresh token đã hết hạn");
        }
        User user = userRepository.findById(refreshToken.getUser())
                 .orElseThrow(() -> new BusinessException(
                HttpStatus.UNAUTHORIZED,
                "INVALID_REFRESH_TOKEN",
                "Refresh Token không hợp lệ"
        ));
        try {
            if (!jwtService.isRefreshTokenValid(token, user)) {
                 throw new BusinessException(
                        HttpStatus.UNAUTHORIZED,
                        "INVALID_REFRESH_TOKEN",
                        "Refresh Token không hợp lệ"
                );
            }
        } catch (JwtException | IllegalArgumentException e) {
            throw new BusinessException(
                    HttpStatus.UNAUTHORIZED,
                    "INVALID_REFRESH_TOKEN",
                    "Refresh Token không hợp lệ"
            );
        }
        return refreshToken;

    }

    @Override
    @Transactional
    public void revoke(RefreshToken token) {
        // danh dau token da bi thu hoi
        token.setRevoked(true);
        refreshTokenRepository.save(token);
    }

    @Override 
    @Transactional 
    public RefreshToken rotate(String oldToken){
        RefreshToken olRefreshToken = verify(oldToken);// kiem tra token cu
        User user = userRepository.findById(olRefreshToken.getUser())
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.UNAUTHORIZED,
                        "INVALID_REFRESH_TOKEN",
                        "Refresh Token không hợp lệ"
                ));
        revoke(olRefreshToken);
        return create(user);

    }

}
