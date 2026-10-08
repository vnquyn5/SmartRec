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
import com.example.smartrec.entity.RefreshToken;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.UpdateUserProfileRequest;
import com.example.smartrec.model.dto.UserProfileReponse;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.JwtService;
import com.example.smartrec.service.RefreshTokenService;
import com.example.smartrec.service.impl.UserServiceImpl;

@ExtendWith(MockitoExtension.class)
class UserServiceImplTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private JwtService jwtService;

    @Mock
    private RefreshTokenService refreshTokenService;

    @InjectMocks
    private UserServiceImpl userService;

    @BeforeEach
    void setUp() {
        TestingAuthenticationToken authentication = new TestingAuthenticationToken("alice@gmail.com", null);
        authentication.setAuthenticated(true);
        SecurityContextHolder.getContext().setAuthentication(authentication);
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
        when(userRepository.existsByEmailIgnoreCase("new@example.com")).thenReturn(false);
        when(userRepository.existsByPhone("0911111111")).thenReturn(false);
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(jwtService.generateToken(user)).thenReturn("new-access-token");
        when(refreshTokenService.create(user)).thenReturn(RefreshToken.builder().token("new-refresh-token").build());
        RefreshToken existingRefreshToken = RefreshToken.builder().user(user.getId()).token("old-refresh-token").build();
        when(refreshTokenService.verify("old-refresh-token")).thenReturn(existingRefreshToken);

        UpdateUserProfileRequest request = new UpdateUserProfileRequest();
        request.setFullName("Nguyễn Văn B");
        request.setEmail("  New@Example.com ");
        request.setPhone("0911111111");
        request.setRefreshToken("old-refresh-token");

        UserProfileReponse response = userService.updateMyProfile(request);

        assertEquals("Nguyễn Văn B", response.getFull_name());
        assertEquals("new@example.com", response.getEmail());
        assertEquals("0911111111", response.getPhone());
        assertEquals("SMR202609210527", response.getUserCode());
        assertEquals("new-access-token", response.getAccessToken());
        assertEquals("new-refresh-token", response.getRefreshToken());
        assertEquals("new@example.com", user.getEmail());
        verify(userRepository).save(user);
        verify(refreshTokenService).revoke(existingRefreshToken);
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
        when(userRepository.existsByEmailIgnoreCase("other@example.com")).thenReturn(true);

        UpdateUserProfileRequest request = new UpdateUserProfileRequest();
        request.setFullName("Nguyễn Văn A");
        request.setEmail("other@example.com");
        request.setPhone("0912345678");

        BusinessException ex = assertThrows(BusinessException.class, () -> userService.updateMyProfile(request));

        assertEquals("EMAIL_ALREADY_EXISTS", ex.getCode());
        verify(userRepository, never()).save(any());
    }

    @Test
    void googleAccountCanUpdateNameWithoutSendingEmail() {
        User user = googleUser();
        when(userRepository.findByEmailOrPhone("alice@gmail.com", "alice@gmail.com")).thenReturn(Optional.of(user));
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        UpdateUserProfileRequest request = new UpdateUserProfileRequest();
        request.setFullName("Nguyễn Văn B");
        request.setPhone("0912345678");

        UserProfileReponse response = userService.updateMyProfile(request);

        assertEquals("Nguyễn Văn B", user.getFull_name());
        assertEquals("alice@gmail.com", user.getEmail());
        assertEquals("GOOGLE", response.getAuthProvider());
        verify(userRepository, never()).existsByEmailIgnoreCase(any());
    }

    @Test
    void googleAccountCanUpdatePhoneAndAcceptUnchangedEmail() {
        User user = googleUser();
        when(userRepository.findByEmailOrPhone("alice@gmail.com", "alice@gmail.com")).thenReturn(Optional.of(user));
        when(userRepository.existsByPhone("0911111111")).thenReturn(false);
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        UpdateUserProfileRequest request = new UpdateUserProfileRequest();
        request.setFullName("Nguyễn Văn B");
        request.setEmail("ALICE@gmail.com");
        request.setPhone("0911111111");

        UserProfileReponse response = userService.updateMyProfile(request);

        assertEquals("0911111111", response.getPhone());
        assertEquals("Nguyễn Văn B", response.getFull_name());
        assertEquals("alice@gmail.com", user.getEmail());
    }

    @Test
    void googleAccountRejectsEmailChangeWithoutSaving() {
        User user = googleUser();
        when(userRepository.findByEmailOrPhone("alice@gmail.com", "alice@gmail.com")).thenReturn(Optional.of(user));
        UpdateUserProfileRequest request = new UpdateUserProfileRequest();
        request.setFullName("Nguyễn Văn A");
        request.setEmail("other@example.com");
        request.setPhone("0912345678");

        BusinessException exception = assertThrows(BusinessException.class, () -> userService.updateMyProfile(request));

        assertEquals("GOOGLE_EMAIL_IMMUTABLE", exception.getCode());
        assertEquals("alice@gmail.com", user.getEmail());
        verify(userRepository, never()).save(any());
    }

    @Test
    void googleProviderIdAlsoMakesEmailImmutable() {
        User user = googleUser();
        user.setAuth_provider("LOCAL");
        when(userRepository.findByEmailOrPhone("alice@gmail.com", "alice@gmail.com")).thenReturn(Optional.of(user));
        UpdateUserProfileRequest request = new UpdateUserProfileRequest();
        request.setFullName("Nguyễn Văn A");
        request.setEmail("other@example.com");
        request.setPhone("0912345678");

        BusinessException exception = assertThrows(BusinessException.class, () -> userService.updateMyProfile(request));

        assertEquals("GOOGLE_EMAIL_IMMUTABLE", exception.getCode());
        verify(userRepository, never()).save(any());
    }

    private User googleUser() {
        return User.builder().id(UUID.randomUUID()).email("alice@gmail.com").phone("0912345678")
                .full_name("Nguyễn Văn A").userCode("SMR202609210527").auth_provider("GOOGLE")
                .provider_id("google-subject").build();
    }
}
