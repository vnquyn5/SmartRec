package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.dto.CreateShareLinkRequest;
import com.example.smartrec.model.dto.CreatedShareLinkResponse;
import com.example.smartrec.model.dto.PublicMeetingShareResponse;
import com.example.smartrec.model.dto.ShareLinkResponse;
import com.example.smartrec.model.dto.ShareLinkAuditResponse;
import com.example.smartrec.model.dto.ShareLinkUpdateRequest;
import com.example.smartrec.model.dto.VerifySharePasscodeResponse;

public interface PublicShareLinkService {
    // Tạo link và trả token gốc đúng một lần trong response này.
    CreatedShareLinkResponse create(UUID meetingId, CreateShareLinkRequest request);
    // Các thao tác dưới đây yêu cầu danh tính JWT và quyền owner trong implementation.
    List<ShareLinkResponse> list(UUID meetingId);
    ShareLinkResponse get(UUID meetingId, UUID shareLinkId);
    List<ShareLinkAuditResponse> audit(UUID meetingId, UUID shareLinkId);
    ShareLinkResponse update(UUID meetingId, UUID shareLinkId, ShareLinkUpdateRequest request);
    void revoke(UUID meetingId, UUID shareLinkId);
    // Guest flow: lấy metadata an toàn hoặc đổi passcode lấy grant Redis tạm thời.
    PublicMeetingShareResponse access(String token, String accessToken);
    VerifySharePasscodeResponse verify(String token, String passcode);
}
