package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.example.smartrec.model.dto.ChangePassWordRequest;
import com.example.smartrec.model.dto.UserProfileReponse;
import com.example.smartrec.service.UserService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;

@RestController
@RequestMapping("/api/user")
@RequiredArgsConstructor
public class UserController {
    private final UserService userService;

    @GetMapping("/me")
    public ResponseEntity<UserProfileReponse> getMyProfile(){
         return ResponseEntity.status(HttpStatus.OK).body(userService.getMyProfile());
    }

    @PutMapping("/change-password")
    public ResponseEntity<String> changePassword(
            @Valid @RequestBody ChangePassWordRequest request) {
        userService.changePassword(request);
         return ResponseEntity.status(HttpStatus.OK).body("Đổi mật khẩu thành công");
    }
}
