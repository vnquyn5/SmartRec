package com.example.smartrec.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.PublicShareLink;
import com.example.smartrec.entity.ShareLinkAudit;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.ShareLinkAuditAction;
import com.example.smartrec.enums.ShareLinkStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.ResourceNotFoundException;
import com.example.smartrec.model.dto.CreateShareLinkRequest;
import com.example.smartrec.model.dto.CreatedShareLinkResponse;
import com.example.smartrec.model.dto.PublicMeetingShareResponse;
import com.example.smartrec.model.dto.ShareLinkResponse;
import com.example.smartrec.model.dto.ShareLinkAuditResponse;
import com.example.smartrec.model.dto.ShareLinkUpdateRequest;
import com.example.smartrec.model.dto.VerifySharePasscodeResponse;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.PublicShareLinkRepository;
import com.example.smartrec.repository.ShareLinkAuditRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.PublicShareLinkService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class PublicShareLinkServiceImpl implements PublicShareLinkService {
    // Grant chỉ sống 15 phút; số lần nhập sai được đếm riêng theo token trong cùng cửa sổ thời gian.
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Duration GRANT_TTL = Duration.ofMinutes(15);
    private static final Duration FAILURE_TTL = Duration.ofMinutes(15);
    private static final long MAX_PASSCODE_FAILURES = 5;

    private final MeetingRepository meetingRepository;
    private final MediaFileRepository mediaFileRepository;
    private final PublicShareLinkRepository shareLinkRepository;
    private final ShareLinkAuditRepository auditRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final RedisTemplate<String, Object> redisTemplate;
    private final ObjectMapper objectMapper;

    @Value("${server.servlet.context-path:}")
    private String contextPath;

    @Override
    @Transactional
    public CreatedShareLinkResponse create(UUID meetingId, CreateShareLinkRequest request) {
        // Luồng tạo: xác định actor -> kiểm tra quyền meeting -> validate -> sinh token -> lưu hash và audit.
        User actor = currentUser();
        Meeting meeting = managedMeeting(meetingId, actor);
        Instant expiresAt = request == null ? null : request.expiresAt();
        String passcode = request == null ? null : request.passcode();
        validateExpiry(expiresAt);
        validatePasscode(passcode);

        // Trả token gốc cho client đúng một lần; database chỉ nhận SHA-256 của token.
        String token = randomToken(32);
        PublicShareLink link = new PublicShareLink();
        link.setMeetingId(meeting.getId());
        link.setCreatedBy(actor.getId());
        link.setTokenHash(sha256(token));
        link.setPasscodeHash(passcode == null || passcode.isBlank() ? null : passwordEncoder.encode(passcode));
        link.setExpiresAt(expiresAt);
        link.setStatus(ShareLinkStatus.ACTIVE);
        link = shareLinkRepository.saveAndFlush(link);
        audit(link, actor, ShareLinkAuditAction.CREATE, null);
        return new CreatedShareLinkResponse(toResponse(link), token,
                contextPath + "/public/share/" + token);
    }

    @Override
    @Transactional(readOnly = true)
    public List<ShareLinkResponse> list(UUID meetingId) {
        // Kiểm tra quyền trước khi truy vấn để không lộ link của meeting người khác.
        User actor = currentUser();
        managedMeeting(meetingId, actor);
        return shareLinkRepository.findAllByMeetingIdOrderByCreatedAtDesc(meetingId)
                .stream().map(this::toResponse).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public ShareLinkResponse get(UUID meetingId, UUID shareLinkId) {
        managedMeeting(meetingId, currentUser());
        return toResponse(managedLink(meetingId, shareLinkId));
    }

    @Override
    @Transactional(readOnly = true)
    public List<ShareLinkAuditResponse> audit(UUID meetingId, UUID shareLinkId) {
        // Audit chỉ hiển thị cho người quản lý meeting; DTO không có token/passcode/hash.
        managedMeeting(meetingId, currentUser());
        PublicShareLink link = managedLink(meetingId, shareLinkId);
        return auditRepository.findAllByShareLinkIdOrderByCreatedAtAsc(link.getId()).stream()
                .map(item -> new ShareLinkAuditResponse(item.getId(), item.getActorId(), item.getAction(),
                        item.getCreatedAt(), item.getMetadata()))
                .toList();
    }

    @Override
    @Transactional
    public ShareLinkResponse update(UUID meetingId, UUID shareLinkId, ShareLinkUpdateRequest request) {
        User actor = currentUser();
        managedMeeting(meetingId, actor);
        PublicShareLink link = managedLink(meetingId, shareLinkId);
        ensureActive(link);
        boolean expiryChanged = request != null && request.expiresAt() != null;
        boolean passcodeChanged = request != null && request.passcode() != null;
        if (!expiryChanged && !passcodeChanged) {
            throw badRequest("EMPTY_SHARE_LINK_UPDATE", "At least one field must be supplied");
        }
        if (expiryChanged) {
            // JsonNode phân biệt trường bị bỏ qua (không đổi) với null tường minh (gỡ expiry).
            JsonNode value = request.expiresAt();
            Instant expiresAt = value.isNull() ? null : parseInstant(value, "expiresAt");
            validateExpiry(expiresAt);
            link.setExpiresAt(expiresAt);
        }
        if (passcodeChanged) {
            // passcode:null hoặc chuỗi rỗng là yêu cầu gỡ; chuỗi khác được BCrypt trước khi lưu.
            JsonNode value = request.passcode();
            if (value.isNull()) {
                link.setPasscodeHash(null);
            } else {
                if (!value.isTextual()) throw badRequest("INVALID_PASSCODE", "passcode must be a string or null");
                String passcode = value.asText();
                validatePasscode(passcode);
                link.setPasscodeHash(passcode.isBlank() ? null : passwordEncoder.encode(passcode));
            }
        }
        link = shareLinkRepository.save(link);
        if (expiryChanged) audit(link, actor, ShareLinkAuditAction.UPDATE_EXPIRY, null);
        if (passcodeChanged) audit(link, actor, ShareLinkAuditAction.UPDATE_PASSCODE,
                request.passcode().isNull() || request.passcode().asText().isBlank() ? "removed" : "set");
        return toResponse(link);
    }

    @Override
    @Transactional
    public void revoke(UUID meetingId, UUID shareLinkId) {
        User actor = currentUser();
        managedMeeting(meetingId, actor);
        PublicShareLink link = managedLink(meetingId, shareLinkId);
        if (link.getStatus() == ShareLinkStatus.REVOKED) return;
        // Thu hồi mềm để giữ lịch sử, đồng thời publicLink sẽ từ chối link này ngay.
        link.setStatus(ShareLinkStatus.REVOKED);
        link.setRevokedAt(Instant.now());
        shareLinkRepository.save(link);
        audit(link, actor, ShareLinkAuditAction.REVOKE, null);
    }

    @Override
    @Transactional(readOnly = true)
    public PublicMeetingShareResponse access(String token, String accessToken) {
        // Mỗi lần truy cập đều kiểm tra trạng thái, hạn dùng và meeting/media; grant không thay token link.
        PublicShareLink link = publicLink(token);
        Meeting meeting = publicMeeting(link);
        if (link.getPasscodeHash() != null) {
            String grantHash = accessToken == null ? null : (String) redisTemplate.opsForValue()
                    .get(grantKey(accessToken));
            if (grantHash == null || !grantHash.equals(link.getPasscodeHash())) {
                throw new BusinessException(HttpStatus.UNAUTHORIZED, "SHARE_PASSCODE_REQUIRED",
                        "Passcode verification is required");
            }
        }
        return new PublicMeetingShareResponse(meeting.getId(), meeting.getTitle(),
                meeting.getStatus(), meeting.getCreated_at());
    }

    @Override
    @Transactional(readOnly = true)
    public VerifySharePasscodeResponse verify(String token, String passcode) {
        // Chỉ cấp grant sau khi token và meeting hợp lệ, passcode đúng và giới hạn thử sai chưa bị chạm.
        PublicShareLink link = publicLink(token);
        publicMeeting(link);
        if (link.getPasscodeHash() == null) {
            throw badRequest("SHARE_LINK_HAS_NO_PASSCODE", "This share link does not require a passcode");
        }
        String failuresKey = failureKey(link.getTokenHash());
        Object existing = redisTemplate.opsForValue().get(failuresKey);
        if (existing instanceof Number number && number.longValue() >= MAX_PASSCODE_FAILURES) {
            throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS, "SHARE_PASSCODE_RATE_LIMITED",
                    "Too many passcode attempts; try again later");
        }
        if (passcode == null || !passwordEncoder.matches(passcode, link.getPasscodeHash())) {
            // Redis INCR đếm atomic; lần thử đầu tạo TTL, lần thứ năm trở đi bị chặn.
            Long failures = redisTemplate.opsForValue().increment(failuresKey);
            if (failures != null && failures == 1L) redisTemplate.expire(failuresKey, FAILURE_TTL);
            if (failures != null && failures >= MAX_PASSCODE_FAILURES) {
                throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS, "SHARE_PASSCODE_RATE_LIMITED",
                        "Too many passcode attempts; try again later");
            }
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "INVALID_SHARE_PASSCODE", "Invalid passcode");
        }
        redisTemplate.delete(failuresKey);
        // Grant ngẫu nhiên được giữ trong Redis với hash passcode hiện tại; đổi passcode sẽ vô hiệu grant cũ.
        String grant = randomToken(32);
        redisTemplate.opsForValue().set(grantKey(grant), link.getPasscodeHash(), GRANT_TTL);
        return new VerifySharePasscodeResponse(grant, Instant.now().plus(GRANT_TTL));
    }

    private Meeting publicMeeting(PublicShareLink link) {
        // Guest chỉ được xem metadata cơ bản; không đọc media object key hoặc kết quả AI ở đây.
        Meeting meeting = meetingRepository.findById(link.getMeetingId()).orElseThrow(this::publicNotFound);
        if (meeting.getDeleted_at() != null) throw publicNotFound();
        MediaFile media = mediaFileRepository.findById(meeting.getMedia_file_id()).orElseThrow(this::publicNotFound);
        if ("TRASHED".equals(media.getStatus()) || "PURGED".equals(media.getStatus())) throw publicNotFound();
        return meeting;
    }

    private PublicShareLink publicLink(String token) {
        // Hash token đầu vào để tra cứu; trả cùng lỗi chung cho token sai, revoked hoặc expired.
        if (token == null || token.length() > 128) throw publicNotFound();
        return shareLinkRepository.findByTokenHash(sha256(token))
                .filter(link -> link.getStatus() == ShareLinkStatus.ACTIVE)
                .filter(link -> link.getExpiresAt() == null || link.getExpiresAt().isAfter(Instant.now()))
                .orElseThrow(this::publicNotFound);
    }

    private Meeting managedMeeting(UUID meetingId, User actor) {
        // Quyền theo mô hình hiện có: workspace_id của meeting phải bằng ID owner đã xác thực.
        Meeting meeting = meetingRepository.findById(meetingId)
                .orElseThrow(() -> new ResourceNotFoundException("MEETING_NOT_FOUND", "Meeting not found"));
        if (!actor.getId().equals(meeting.getWorkspace_id())) {
            throw new BusinessException(HttpStatus.FORBIDDEN, "MEETING_ACCESS_DENIED", "Meeting management access denied");
        }
        if (meeting.getDeleted_at() != null) throw new ResourceNotFoundException("MEETING_NOT_FOUND", "Meeting not found");
        return meeting;
    }

    private PublicShareLink managedLink(UUID meetingId, UUID shareLinkId) {
        return shareLinkRepository.findByIdAndMeetingId(shareLinkId, meetingId)
                .orElseThrow(() -> new ResourceNotFoundException("SHARE_LINK_NOT_FOUND", "Share link not found"));
    }

    private User currentUser() {
        // JWT filter đặt email làm Authentication name; tra phone dự phòng theo convention service hiện hữu.
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authentication required");
        }
        String identifier = authentication.getName();
        return userRepository.findByEmail(identifier).or(() -> userRepository.findByPhone(identifier))
                .orElseThrow(() -> new BusinessException(HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "User not found"));
    }

    private void audit(PublicShareLink link, User actor, ShareLinkAuditAction action, String metadata) {
        // Chỉ ghi actor/action và metadata mô tả thao tác; không truyền secret vào audit.
        ShareLinkAudit audit = new ShareLinkAudit();
        audit.setShareLinkId(link.getId());
        audit.setActorId(actor.getId());
        audit.setAction(action);
        audit.setMetadata(metadata);
        auditRepository.save(audit);
    }

    private ShareLinkResponse toResponse(PublicShareLink link) {
        return new ShareLinkResponse(link.getId(), link.getMeetingId(), link.getStatus(), link.getExpiresAt(),
                link.getRevokedAt(), link.getCreatedAt(), link.getUpdatedAt(), link.getPasscodeHash() != null);
    }

    private void ensureActive(PublicShareLink link) {
        if (link.getStatus() != ShareLinkStatus.ACTIVE) {
            throw new BusinessException(HttpStatus.CONFLICT, "SHARE_LINK_REVOKED", "Share link is revoked");
        }
    }

    private void validateExpiry(Instant expiresAt) {
        if (expiresAt != null && !expiresAt.isAfter(Instant.now())) {
            throw badRequest("INVALID_SHARE_LINK_EXPIRY", "expiresAt must be in the future");
        }
    }

    private void validatePasscode(String passcode) {
        if (passcode != null && !passcode.isBlank()
                && (passcode.length() < 4 || passcode.length() > 72
                    || passcode.getBytes(StandardCharsets.UTF_8).length > 72)) {
            throw badRequest("INVALID_SHARE_PASSCODE", "passcode must contain 4 to 72 characters");
        }
    }

    private Instant parseInstant(JsonNode value, String field) {
        try {
            return objectMapper.treeToValue(value, Instant.class);
        } catch (Exception ex) {
            throw badRequest("INVALID_SHARE_LINK_EXPIRY", field + " must be an ISO-8601 instant or null");
        }
    }

    private String randomToken(int bytes) {
        // 32 byte ngẫu nhiên tương đương 256 bit entropy; Base64 URL-safe để dùng trong path.
        byte[] value = new byte[bytes];
        RANDOM.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private String sha256(String value) {
        // SHA-256 dùng cho token tra cứu; passcode dùng PasswordEncoder riêng vì cần chống dò mật khẩu.
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }

    private String grantKey(String token) { return "share:grant:" + sha256(token); }
    private String failureKey(String tokenHash) { return "share:fail:" + tokenHash; }

    private BusinessException badRequest(String code, String message) {
        return new BusinessException(HttpStatus.BAD_REQUEST, code, message);
    }

    private ResourceNotFoundException publicNotFound() {
        return new ResourceNotFoundException("SHARE_LINK_UNAVAILABLE", "Share link is unavailable");
    }
}
