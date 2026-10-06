package com.example.smartrec.service;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;

public interface GoogleTokenService {

    GoogleIdToken.Payload verify(String idToken);
} 
