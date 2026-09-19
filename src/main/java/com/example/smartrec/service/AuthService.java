package com.example.smartrec.service;

import com.example.smartrec.model.dto.LoginRequest;
import com.example.smartrec.model.dto.LoginResponse;
import com.example.smartrec.model.dto.RegisterRequest;

public interface AuthService {
    void register(RegisterRequest request);

    LoginResponse login(LoginRequest request);
} 