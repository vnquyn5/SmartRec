package com.example.smartrec.service.impl;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Folder;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.FolderRequest;
import com.example.smartrec.model.dto.FolderResponse;
import com.example.smartrec.model.dto.MoveMeetingsRequest;
import com.example.smartrec.model.dto.MoveMeetingsResponse;
import com.example.smartrec.repository.FolderRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.FolderService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class FolderServiceImpl implements FolderService {
    private final FolderRepository folderRepository;
    private final MeetingRepository meetingRepository;
    private final UserRepository userRepository;

    @Override
    @Transactional(readOnly = true)
    public List<FolderResponse> getFolders(String parentId) {
        User user = getCurrentUser();
        List<Folder> folders;
        if (parentId == null || "all".equalsIgnoreCase(parentId)) {
            folders = folderRepository.findAllByUserIdOrderByNameAsc(user.getId());
        } else if ("root".equalsIgnoreCase(parentId)) {
            folders = folderRepository.findAllByUserIdAndParentIdIsNullOrderByNameAsc(user.getId());
        } else {
            UUID parentUuid = parseFolderId(parentId);
            requireOwnedFolder(parentUuid, user.getId(), "Không tìm thấy thư mục cha");
            folders = folderRepository.findAllByUserIdAndParentIdOrderByNameAsc(user.getId(), parentUuid);
        }
        return folders.stream()
                .map(FolderResponse::from)
                .toList();
    }

    @Override
    @Transactional
    public FolderResponse createFolder(FolderRequest request) {
        User user = getCurrentUser();
        String name = validateName(request == null ? null : request.getName());
        UUID parentId = request.getParentId();
        if (parentId != null) requireOwnedFolder(parentId, user.getId(), "Không tìm thấy thư mục cha");
        ensureNameAvailable(user.getId(), parentId, name, null);
        Folder folder = folderRepository.save(Folder.builder().userId(user.getId()).parentId(parentId).name(name).nameKey(nameKey(name)).build());
        return FolderResponse.from(folder);
    }

    @Override
    @Transactional
    public FolderResponse renameFolder(UUID folderId, FolderRequest request) {
        User user = getCurrentUser();
        Folder folder = folderRepository.findByIdAndUserId(folderId, user.getId())
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "FOLDER_NOT_FOUND", "Không tìm thấy thư mục"));
        String name = validateName(request == null ? null : request.getName());
        ensureNameAvailable(user.getId(), folder.getParentId(), name, folderId);
        folder.setName(name);
        folder.setNameKey(nameKey(name));
        return FolderResponse.from(folderRepository.save(folder));
    }

    @Override
    @Transactional
    public MoveMeetingsResponse moveMeetings(MoveMeetingsRequest request) {
        if (request == null || request.getMeetingIds() == null || request.getMeetingIds().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "EMPTY_MEETING_SELECTION", "Vui lòng chọn ít nhất một tệp");
        }
        LinkedHashSet<UUID> ids = new LinkedHashSet<>(request.getMeetingIds());
        if (ids.contains(null)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_MEETING_ID", "Mã tệp không hợp lệ");
        }

        User user = getCurrentUser();
        UUID folderId = request.getFolderId();
        if (folderId != null && folderRepository.findByIdAndUserId(folderId, user.getId()).isEmpty()) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "FOLDER_NOT_FOUND", "Không tìm thấy thư mục đích");
        }

        List<Meeting> meetings = meetingRepository.findAllOwnedMeetingsByIds(user.getId(), ids);
        if (meetings.size() != ids.size()) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "MEETING_NOT_FOUND", "Một hoặc nhiều tệp không tồn tại");
        }
        meetings.forEach(meeting -> meeting.setFolder_id(folderId));
        meetingRepository.saveAll(meetings);
        return new MoveMeetingsResponse(meetings.size(), folderId, meetings.stream().map(Meeting::getId).toList());
    }

    private String validateName(String value) {
        if (value == null || value.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_FOLDER_NAME", "Tên thư mục không được để trống");
        }
        String name = value.trim();
        if (name.length() > 100) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "FOLDER_NAME_TOO_LONG", "Tên thư mục tối đa 100 ký tự");
        }
        return name;
    }

    private void ensureNameAvailable(UUID userId, UUID parentId, String name, UUID excludedId) {
        String key = nameKey(name);
        boolean exists;
        if (parentId == null) {
            exists = excludedId == null
                    ? folderRepository.existsByUserIdAndParentIdIsNullAndNameKey(userId, key)
                    : folderRepository.existsByUserIdAndParentIdIsNullAndNameKeyAndIdNot(userId, key, excludedId);
        } else {
            exists = excludedId == null
                    ? folderRepository.existsByUserIdAndParentIdAndNameKey(userId, parentId, key)
                    : folderRepository.existsByUserIdAndParentIdAndNameKeyAndIdNot(userId, parentId, key, excludedId);
        }
        if (exists) {
            throw new BusinessException(HttpStatus.CONFLICT, "FOLDER_NAME_EXISTS", "Bạn đã có thư mục trùng tên");
        }
    }

    private String nameKey(String name) {
        return name.toLowerCase(Locale.ROOT);
    }

    private UUID parseFolderId(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException invalidId) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_FOLDER_ID", "Mã thư mục không hợp lệ");
        }
    }

    private Folder requireOwnedFolder(UUID folderId, UUID userId, String message) {
        return folderRepository.findByIdAndUserId(folderId, userId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "FOLDER_NOT_FOUND", message));
    }

    private User getCurrentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập");
        }
        String identifier = authentication.getName();
        return userRepository.findByEmail(identifier)
                .or(() -> userRepository.findByPhone(identifier))
                .orElseThrow(() -> new BusinessException(HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "Không tìm thấy người dùng đăng nhập"));
    }
}
