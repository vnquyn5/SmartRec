package com.example.smartrec.service;

import com.example.smartrec.entity.User;

public interface JwtService {

    String generateToken(User user);

    String extractEmail(String token);

    boolean isTokenValid(String token, User user);

    String generateRefreshToken(User user);

    boolean isRefreshTokenValid(String token, User user);
}
