package com.example.smartrec.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.CreateShareLinkRequest;
import com.example.smartrec.model.dto.CreatedShareLinkResponse;
import com.example.smartrec.model.dto.PublicMeetingShareResponse;
import com.example.smartrec.model.dto.ShareLinkResponse;
import com.example.smartrec.model.dto.ShareLinkAuditResponse;
import com.example.smartrec.model.dto.ShareLinkUpdateRequest;
import com.example.smartrec.model.dto.VerifySharePasscodeRequest;
import com.example.smartrec.model.dto.VerifySharePasscodeResponse;
import com.example.smartrec.service.PublicShareLinkService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequiredArgsConstructor
public class PublicShareLinkController {
    private final PublicShareLinkService shareLinkService;

    // Các route /meetings/** được SecurityConfig yêu cầu JWT; service kiểm tra tiếp quyền owner.
    // Body có thể vắng mặt; nếu có body, @Valid chạy trước khi gọi service.
    @PostMapping("/meetings/{meetingId}/share-links")
    public ResponseEntity<CreatedShareLinkResponse> create(
            @PathVariable UUID meetingId,
            @Valid @RequestBody(required = false) CreateShareLinkRequest request) {
        return ResponseEntity.ok(shareLinkService.create(meetingId, request));
    }

    // Trả metadata của các link thuộc meeting; service không đưa token/hash vào DTO.
    @GetMapping("/meetings/{meetingId}/share-links")
    public ResponseEntity<List<ShareLinkResponse>> list(@PathVariable UUID meetingId) {
        return ResponseEntity.ok(shareLinkService.list(meetingId));
    }

    // Service xác nhận quyền meeting và cặp meetingId/shareLinkId trước khi trả detail.
    @GetMapping("/meetings/{meetingId}/share-links/{shareLinkId}")
    public ResponseEntity<ShareLinkResponse> get(
            @PathVariable UUID meetingId,
            @PathVariable UUID shareLinkId) {
        return ResponseEntity.ok(shareLinkService.get(meetingId, shareLinkId));
    }

    // Lịch sử chỉ đọc, được bảo vệ như các API quản lý link.
    @GetMapping("/meetings/{meetingId}/share-links/{shareLinkId}/audit")
    public ResponseEntity<List<ShareLinkAuditResponse>> audit(
            @PathVariable UUID meetingId,
            @PathVariable UUID shareLinkId) {
        return ResponseEntity.ok(shareLinkService.audit(meetingId, shareLinkId));
    }

    // Giữ JsonNode để service phân biệt field bị bỏ qua với null được gửi tường minh.
    @PatchMapping("/meetings/{meetingId}/share-links/{shareLinkId}")
    public ResponseEntity<ShareLinkResponse> update(
            @PathVariable UUID meetingId,
            @PathVariable UUID shareLinkId,
            @RequestBody ShareLinkUpdateRequest request) {
        return ResponseEntity.ok(shareLinkService.update(meetingId, shareLinkId, request));
    }

    // Thu hồi logic, không xóa bản ghi; trả 204 khi service xử lý xong.
    @DeleteMapping("/meetings/{meetingId}/share-links/{shareLinkId}")
    public ResponseEntity<Void> revoke(
            @PathVariable UUID meetingId,
            @PathVariable UUID shareLinkId) {
        shareLinkService.revoke(meetingId, shareLinkId);
        return ResponseEntity.noContent().build();
    }

    // Endpoint đọc public share; service vẫn tự kiểm tra link, expiry và passcode protection.
    @GetMapping("/public/share/{token}")
    public ResponseEntity<PublicMeetingShareResponse> access(
            @PathVariable String token, // Token chia sẻ nằm trong path, không phải JWT của phiên Guest.
            @RequestHeader(name = "X-Share-Access-Token", required = false) String legacyAccessToken, // Header tương thích client cũ.
            @RequestHeader(name = "Authorization", required = false) String authorization) { // Cách chuẩn: Bearer JWT.
        // Nếu có Authorization Bearer thì ưu tiên JWT mới; nếu không, dùng header cũ.
        String accessToken = authorization != null && authorization.startsWith("Bearer ")
                ? authorization.substring("Bearer ".length()) : legacyAccessToken; // Service nhận chuỗi JWT thuần.
        return ResponseEntity.ok(shareLinkService.access(token, accessToken)); // Trả metadata trong scope public hiện tại.
    }

    // Passcode không được gửi trong GET hoặc query string; endpoint này nhận JSON body qua HTTPS.
    // Nhận passcode trong JSON body thay vì URL để tránh lộ qua query/access log.
    @PostMapping("/public/share/{token}/verify")
    public ResponseEntity<VerifySharePasscodeResponse> verify(
            @PathVariable String token, // Token link dùng để xác định PublicShareLink cần xác minh.
            @Valid @RequestBody VerifySharePasscodeRequest request) { // Bean Validation kiểm tra JSON/passcode.
        return ResponseEntity.ok(shareLinkService.verify(token, request.passcode())); // Trả JWT nếu mọi điều kiện đều hợp lệ.
    }
}
