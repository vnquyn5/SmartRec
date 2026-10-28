package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import com.example.smartrec.entity.Folder;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.FolderRequest;
import com.example.smartrec.model.dto.MoveMeetingsRequest;
import com.example.smartrec.repository.FolderRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.FolderServiceImpl;

@ExtendWith(MockitoExtension.class)
class FolderServiceTest {
    @Mock private FolderRepository folderRepository;
    @Mock private MeetingRepository meetingRepository;
    @Mock private UserRepository userRepository;

    private FolderServiceImpl folderService;
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        folderService = new FolderServiceImpl(folderRepository, meetingRepository, userRepository);
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken("alice@example.com", null, List.of(() -> "USER")));
        when(userRepository.findByEmail("alice@example.com"))
                .thenReturn(Optional.of(User.builder().id(userId).email("alice@example.com").build()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void createsTrimmedFolderOnlyAfterCheckingUserScopedName() {
        when(folderRepository.existsByUserIdAndParentIdIsNullAndNameKey(userId, "projects")).thenReturn(false);
        when(folderRepository.save(any(Folder.class))).thenAnswer(invocation -> invocation.getArgument(0));
        FolderRequest request = new FolderRequest();
        request.setName("  Projects  ");

        var created = folderService.createFolder(request);

        assertEquals("Projects", created.name());
        ArgumentCaptor<Folder> savedFolder = ArgumentCaptor.forClass(Folder.class);
        verify(folderRepository).save(savedFolder.capture());
        assertEquals(userId, savedFolder.getValue().getUserId());
        assertNull(savedFolder.getValue().getParentId());
        assertEquals("projects", savedFolder.getValue().getNameKey());
    }

    @Test
    void createsChildOnlyUnderAnOwnedParent() {
        UUID parentId = UUID.randomUUID();
        when(folderRepository.findByIdAndUserId(parentId, userId))
                .thenReturn(Optional.of(Folder.builder().id(parentId).userId(userId).build()));
        when(folderRepository.existsByUserIdAndParentIdAndNameKey(userId, parentId, "minutes"))
                .thenReturn(false);
        when(folderRepository.save(any(Folder.class))).thenAnswer(invocation -> invocation.getArgument(0));
        FolderRequest request = new FolderRequest();
        request.setName("Minutes");
        request.setParentId(parentId);

        folderService.createFolder(request);

        ArgumentCaptor<Folder> savedFolder = ArgumentCaptor.forClass(Folder.class);
        verify(folderRepository).save(savedFolder.capture());
        assertEquals(parentId, savedFolder.getValue().getParentId());
    }

    @Test
    void listsOnlyDirectChildrenOfTheRequestedOwnedFolder() {
        UUID parentId = UUID.randomUUID();
        when(folderRepository.findByIdAndUserId(parentId, userId))
                .thenReturn(Optional.of(Folder.builder().id(parentId).userId(userId).build()));
        when(folderRepository.findAllByUserIdAndParentIdOrderByNameAsc(userId, parentId))
                .thenReturn(List.of(Folder.builder().id(UUID.randomUUID()).userId(userId).parentId(parentId)
                        .name("Child").nameKey("child").build()));

        var result = folderService.getFolders(parentId.toString());

        assertEquals(1, result.size());
        assertEquals(parentId, result.get(0).parentId());
        verify(folderRepository).findAllByUserIdAndParentIdOrderByNameAsc(userId, parentId);
    }

    @Test
    void rejectsBlankAndDuplicateFolderNames() {
        FolderRequest blank = new FolderRequest();
        blank.setName("   ");
        BusinessException blankError = assertThrows(BusinessException.class, () -> folderService.createFolder(blank));
        assertEquals(HttpStatus.BAD_REQUEST, blankError.getStatus());

        when(folderRepository.existsByUserIdAndParentIdIsNullAndNameKey(userId, "projects")).thenReturn(true);
        FolderRequest duplicate = new FolderRequest();
        duplicate.setName("Projects");
        BusinessException duplicateError = assertThrows(BusinessException.class,
                () -> folderService.createFolder(duplicate));
        assertEquals(HttpStatus.CONFLICT, duplicateError.getStatus());
        verify(folderRepository, never()).save(any());
    }

    @Test
    void renamesOwnedFolderWithoutChangingItsId() {
        UUID folderId = UUID.randomUUID();
        Folder folder = Folder.builder().id(folderId).userId(userId).name("Old name").nameKey("old name").build();
        when(folderRepository.findByIdAndUserId(folderId, userId)).thenReturn(Optional.of(folder));
        when(folderRepository.existsByUserIdAndParentIdIsNullAndNameKeyAndIdNot(userId, "new name", folderId)).thenReturn(false);
        when(folderRepository.save(folder)).thenReturn(folder);
        FolderRequest request = new FolderRequest();
        request.setName(" New name ");

        var renamed = folderService.renameFolder(folderId, request);

        assertEquals(folderId, renamed.id());
        assertEquals("New name", renamed.name());
        assertEquals("new name", folder.getNameKey());
    }

    @Test
    void movingMeetingsChangesOnlyFolderMembership() {
        UUID folderId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        Meeting meeting = Meeting.builder().id(meetingId).workspace_id(userId)
                .folder_id(null).status(MeetingStatus.PROCESSING).title("Original title").build();
        when(folderRepository.findByIdAndUserId(folderId, userId))
                .thenReturn(Optional.of(Folder.builder().id(folderId).userId(userId).name("Projects").build()));
        when(meetingRepository.findAllOwnedMeetingsByIds(eq(userId), anyCollection()))
                .thenReturn(List.of(meeting));
        when(meetingRepository.saveAll(any())).thenAnswer(invocation -> invocation.getArgument(0));
        MoveMeetingsRequest request = new MoveMeetingsRequest();
        request.setFolderId(folderId);
        request.setMeetingIds(List.of(meetingId));

        var result = folderService.moveMeetings(request);

        assertEquals(1, result.movedCount());
        assertEquals(folderId, meeting.getFolder_id());
        assertEquals(MeetingStatus.PROCESSING, meeting.getStatus());
        assertEquals("Original title", meeting.getTitle());
    }

    @Test
    void rejectsMoveAtomicallyWhenASelectedMeetingIsNotOwned() {
        UUID meetingId = UUID.randomUUID();
        when(meetingRepository.findAllOwnedMeetingsByIds(eq(userId), anyCollection()))
                .thenReturn(List.of());
        MoveMeetingsRequest request = new MoveMeetingsRequest();
        request.setMeetingIds(List.of(meetingId));

        BusinessException error = assertThrows(BusinessException.class, () -> folderService.moveMeetings(request));

        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        verify(meetingRepository, never()).saveAll(any());
    }

    @Test
    void movingToRootOnlyClearsFolderMembership() {
        UUID oldFolderId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        Meeting meeting = Meeting.builder().id(meetingId).workspace_id(userId).folder_id(oldFolderId)
                .status(MeetingStatus.COMPLETED).title("Processed meeting").build();
        when(meetingRepository.findAllOwnedMeetingsByIds(eq(userId), anyCollection()))
                .thenReturn(List.of(meeting));
        when(meetingRepository.saveAll(any())).thenAnswer(invocation -> invocation.getArgument(0));
        MoveMeetingsRequest request = new MoveMeetingsRequest();
        request.setMeetingIds(List.of(meetingId));
        request.setFolderId(null);

        var result = folderService.moveMeetings(request);

        assertNull(meeting.getFolder_id());
        assertEquals(MeetingStatus.COMPLETED, meeting.getStatus());
        assertNull(result.folderId());
        assertEquals(1, result.movedCount());
    }
}
