package com.example.smartrec.service;

import com.example.smartrec.model.dto.ChangePassWordRequest;
import com.example.smartrec.model.dto.UpdateUserProfileRequest;
import com.example.smartrec.model.dto.UserProfileReponse;

public interface UserService {
    UserProfileReponse getMyProfile();

    UserProfileReponse updateMyProfile(UpdateUserProfileRequest request);

    void changePassword(ChangePassWordRequest request);

}
