package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.dto.ChangePassWordRequest;
import com.example.smartrec.model.dto.UserProfileReponse;

public interface UserService {
    UserProfileReponse getMyProfile();

    void changePassword(ChangePassWordRequest request);
    
} 
