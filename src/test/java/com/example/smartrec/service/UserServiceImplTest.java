package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.UpdateUserProfileRequest;
import com.example.smartrec.model.dto.UserProfileReponse;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.UserServiceImpl;

@ExtendWith(MockitoExtension.class)
class UserServiceImplTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @InjectMocks
    private UserServiceImpl userService;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.getContext().setAuthentication(
            new TestingAuthenticationToken("alice@gmail.com", null)
        );
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void shouldUpdateProfileFieldsAndReturnResponse() {
        User user = User.builder()
                .id(UUID.randomUUID())
                .email("alice@gmail.com")
                .phone("0912345678")
                .full_name("Nguyễn Văn A")
                .userCode("SMR202609210527")
                .department("Phòng Công nghệ thông tin")
                .position("Nhân viên")
                .build();

        when(userRepository.findByEmailOrPhone("alice@gmail.com", "alice@gmail.com"))
                .thenReturn(Optional.of(user));
        when(userRepository.existsByEmail("new@example.com")).thenReturn(false);
        when(userRepository.existsByPhone("0911111111")).thenReturn(false);
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        UpdateUserProfileRequest request = new UpdateUserProfileRequest();
        request.setFullName("Nguyễn Văn B");
        request.setEmail("new@example.com");
        request.setPhone("0911111111");

        UserProfileReponse response = userService.updateMyProfile(request);

        assertEquals("Nguyễn Văn B", response.getFull_name());
        assertEquals("new@example.com", response.getEmail());
        assertEquals("0911111111", response.getPhone());
        assertEquals("SMR202609210527", response.getUserCode());
        verify(userRepository).save(user);
    }

    @Test
    void shouldRejectDuplicateEmail() {
        User user = User.builder()
                .id(UUID.randomUUID())
                .email("alice@gmail.com")
                .phone("0912345678")
                .full_name("Nguyễn Văn A")
                .userCode("SMR202609210527")
                .build();

        when(userRepository.findByEmailOrPhone("alice@gmail.com", "alice@gmail.com"))
                .thenReturn(Optional.of(user));
        when(userRepository.existsByEmail("other@example.com")).thenReturn(true);

        UpdateUserProfileRequest request = new UpdateUserProfileRequest();
        request.setFullName("Nguyễn Văn A");
        request.setEmail("other@example.com");
        request.setPhone("0912345678");

        BusinessException ex = assertThrows(BusinessException.class, () -> userService.updateMyProfile(request));

        assertEquals("EMAIL_ALREADY_EXISTS", ex.getCode());
        verify(userRepository, never()).save(any());
    }
}
