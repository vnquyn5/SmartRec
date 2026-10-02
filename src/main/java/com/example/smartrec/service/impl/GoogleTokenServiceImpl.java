package com.example.smartrec.service.impl;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.GoogleTokenService;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;

import lombok.RequiredArgsConstructor;

@Service 
@RequiredArgsConstructor 
public class GoogleTokenServiceImpl implements GoogleTokenService {
    private final GoogleIdTokenVerifier verifier; // khai bao verifier de xac minh gg id tocken

    @Override 
    public GoogleIdToken.Payload verify(String idToken){
        try {
            // yeu cau GoogleIdTokenVerifier xac minh token, neu token hop le , tra ve GoogleIdToken,neu khong hop le tra ve null 
            GoogleIdToken googleIdToken = verifier.verify(idToken);
            if(googleIdToken == null){
                 throw new BusinessException(
                    HttpStatus.UNAUTHORIZED,
                    "INVALID_GOOGLE_ID_TOKEN",
                    "gg id token không hợp lệ");
            }

            // lay payload  chua cac claim cua token sa xac minh
            return googleIdToken.getPayload();
        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.UNAUTHORIZED,
                    "INVALID_GOOGLE_ID_TOKEN",
                    "gg id token không hợp lệ");
        }
    }
    
}
