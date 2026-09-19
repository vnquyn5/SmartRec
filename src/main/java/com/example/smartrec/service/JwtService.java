package com.example.smartrec.service;

import com.example.smartrec.entity.User;

public interface JwtService {

    String generateToken(User user);

    String extractEmail(String token);

    boolean isTokenValid(String token, User user);
} 
