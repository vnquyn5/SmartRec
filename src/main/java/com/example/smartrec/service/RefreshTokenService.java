package com.example.smartrec.service;

import com.example.smartrec.entity.RefreshToken;
import com.example.smartrec.entity.User;

public interface RefreshTokenService {
    RefreshToken create(User user);
    RefreshToken verify(String token);
    RefreshToken rotate(String oldToken);
    void revoke(RefreshToken token);
    
} 
