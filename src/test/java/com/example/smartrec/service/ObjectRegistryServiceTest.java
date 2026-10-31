package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import com.example.smartrec.entity.ObjectAuditLog;
import com.example.smartrec.entity.ObjectRegistry;
import com.example.smartrec.enums.ArtifactType;
import com.example.smartrec.enums.ObjectState;
import com.example.smartrec.exception.DuplicateObjectKeyException;
import com.example.smartrec.exception.InvalidStateTransitionException;
import com.example.smartrec.exception.ObjectIntegrityException;
import com.example.smartrec.model.dto.request.RegisterObjectRequest;
import com.example.smartrec.model.dto.request.TransitionStateRequest;
import com.example.smartrec.model.dto.response.ObjectLineageResponse;
import com.example.smartrec.model.dto.response.ObjectRegistryResponse;
import com.example.smartrec.repository.ObjectAuditLogRepository;
import com.example.smartrec.repository.ObjectRegistryRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.ObjectRegistryServiceImpl;
import com.example.smartrec.service.statemachine.impl.ObjectStateMachineImpl;

@ExtendWith(MockitoExtension.class)
class ObjectRegistryServiceTest {

    @Mock
    private ObjectRegistryRepository registryRepository;

    @Mock
    private ObjectAuditLogRepository auditLogRepository;

    @Mock
    private UserRepository userRepository;

    @Spy
    private ObjectStateMachineImpl stateMachine;

    @InjectMocks
    private ObjectRegistryServiceImpl registryService;

    private UUID ownerId;
    private UUID objectId;

    @BeforeEach
    void setUp() {
        ownerId = UUID.randomUUID();
        objectId = UUID.randomUUID();
    }

    @Test
    @DisplayName("1. Đăng ký object hợp lệ (chưa có file) -> State khởi tạo là PENDING và ghi audit log")
    void testRegisterObject_PendingSuccess() {
        RegisterObjectRequest request = RegisterObjectRequest.builder()
                .bucket("smartrec-media")
                .objectKey("meetings/123/raw.mp4")
                .artifactType(ArtifactType.ORIGINAL_MEDIA)
                .ownerId(ownerId)
                .build();

        when(userRepository.existsById(ownerId)).thenReturn(true);
        when(registryRepository.findByBucketAndObjectKey("smartrec-media", "meetings/123/raw.mp4"))
                .thenReturn(Optional.empty());

        when(registryRepository.save(any(ObjectRegistry.class))).thenAnswer(invocation -> {
            ObjectRegistry obj = invocation.getArgument(0);
            obj.setId(objectId);
            return obj;
        });

        ObjectRegistryResponse response = registryService.registerObject(request);

        assertNotNull(response);
        assertEquals(ObjectState.PENDING, response.getState());
        assertEquals("smartrec-media", response.getBucket());
        assertEquals("meetings/123/raw.mp4", response.getObjectKey());
        verify(auditLogRepository).save(any(ObjectAuditLog.class));
    }

    @Test
    @DisplayName("2. Đăng ký object có file sẵn (kèm size và checksum) -> State khởi tạo trực tiếp là READY")
    void testRegisterObject_DirectReadySuccess() {
        RegisterObjectRequest request = RegisterObjectRequest.builder()
                .bucket("smartrec-media")
                .objectKey("meetings/123/thumbnail.png")
                .artifactType(ArtifactType.ATTACHMENT)
                .sizeBytes(2048L)
                .checksum("sha256:thumb123")
                .ownerId(ownerId)
                .build();

        when(userRepository.existsById(ownerId)).thenReturn(true);
        when(registryRepository.findByBucketAndObjectKey("smartrec-media", "meetings/123/thumbnail.png"))
                .thenReturn(Optional.empty());

        when(registryRepository.save(any(ObjectRegistry.class))).thenAnswer(invocation -> {
            ObjectRegistry obj = invocation.getArgument(0);
            obj.setId(objectId);
            return obj;
        });

        ObjectRegistryResponse response = registryService.registerObject(request);

        assertNotNull(response);
        assertEquals(ObjectState.READY, response.getState());
        assertEquals(2048L, response.getSizeBytes());
        assertEquals("sha256:thumb123", response.getChecksum());
    }

    @Test
    @DisplayName("3. Chặn tạo object vô chủ: ném ngoại lệ khi ownerId không tồn tại")
    void testRegisterObject_OrphanBlockedThrowsException() {
        RegisterObjectRequest request = RegisterObjectRequest.builder()
                .bucket("smartrec-media")
                .objectKey("meetings/orphan/raw.mp4")
                .artifactType(ArtifactType.ORIGINAL_MEDIA)
                .ownerId(ownerId)
                .build();

        when(userRepository.existsById(ownerId)).thenReturn(false);

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, 
                () -> registryService.registerObject(request));
        assertEquals("Cannot create orphan object: Owner with ID " + ownerId + " does not exist", ex.getMessage());
        verify(registryRepository, never()).save(any(ObjectRegistry.class));
    }

    @Test
    @DisplayName("4. Đăng ký trùng bucket/key khác checksum -> Ném ngoại lệ DuplicateObjectKeyException")
    void testRegisterObject_DuplicateKeyThrowsException() {
        RegisterObjectRequest request = RegisterObjectRequest.builder()
                .bucket("smartrec-media")
                .objectKey("meetings/123/raw.mp4")
                .artifactType(ArtifactType.ORIGINAL_MEDIA)
                .ownerId(ownerId)
                .checksum("sha256:new_hash")
                .build();

        ObjectRegistry existing = ObjectRegistry.builder()
                .id(UUID.randomUUID())
                .bucket("smartrec-media")
                .objectKey("meetings/123/raw.mp4")
                .ownerId(ownerId)
                .checksum("sha256:old_hash")
                .build();

        when(userRepository.existsById(ownerId)).thenReturn(true);
        when(registryRepository.findByBucketAndObjectKey("smartrec-media", "meetings/123/raw.mp4"))
                .thenReturn(Optional.of(existing));

        assertThrows(DuplicateObjectKeyException.class, () -> registryService.registerObject(request));
        verify(auditLogRepository, never()).save(any(ObjectAuditLog.class));
    }

    @Test
    @DisplayName("5. Đăng ký Idempotent: trùng bucket/key và cùng checksum -> Trả về bản ghi hiện tại")
    void testRegisterObject_IdempotentSuccess() {
        RegisterObjectRequest request = RegisterObjectRequest.builder()
                .bucket("smartrec-media")
                .objectKey("meetings/123/raw.mp4")
                .artifactType(ArtifactType.ORIGINAL_MEDIA)
                .ownerId(ownerId)
                .checksum("sha256:same_hash")
                .build();

        ObjectRegistry existing = ObjectRegistry.builder()
                .id(objectId)
                .bucket("smartrec-media")
                .objectKey("meetings/123/raw.mp4")
                .ownerId(ownerId)
                .checksum("sha256:same_hash")
                .state(ObjectState.READY)
                .build();

        when(userRepository.existsById(ownerId)).thenReturn(true);
        when(registryRepository.findByBucketAndObjectKey("smartrec-media", "meetings/123/raw.mp4"))
                .thenReturn(Optional.of(existing));

        ObjectRegistryResponse response = registryService.registerObject(request);

        assertNotNull(response);
        assertEquals(objectId, response.getId());
        assertEquals(ObjectState.READY, response.getState());
        verify(registryRepository, never()).save(any(ObjectRegistry.class));
    }

    @Test
    @DisplayName("6. Transition hợp lệ: PENDING -> UPLOADING -> READY kèm checksum và size")
    void testValidStateTransitionChain() {
        ObjectRegistry object = ObjectRegistry.builder()
                .id(objectId)
                .bucket("smartrec-media")
                .objectKey("meetings/123/audio.wav")
                .state(ObjectState.PENDING)
                .ownerId(ownerId)
                .build();

        when(registryRepository.findById(objectId)).thenReturn(Optional.of(object));
        when(registryRepository.save(any(ObjectRegistry.class))).thenAnswer(i -> i.getArgument(0));

        TransitionStateRequest uploadReq = TransitionStateRequest.builder()
                .targetState(ObjectState.UPLOADING)
                .reason("Client started chunk streaming")
                .build();

        ObjectRegistryResponse uploadResp = registryService.transitionState(objectId, uploadReq);
        assertEquals(ObjectState.UPLOADING, uploadResp.getState());

        TransitionStateRequest readyReq = TransitionStateRequest.builder()
                .targetState(ObjectState.READY)
                .sizeBytes(1048576L)
                .checksum("sha256:abc123def456")
                .reason("Upload complete and verified")
                .build();

        ObjectRegistryResponse readyResp = registryService.transitionState(objectId, readyReq);
        assertEquals(ObjectState.READY, readyResp.getState());
        assertEquals(1048576L, readyResp.getSizeBytes());
        assertEquals("sha256:abc123def456", readyResp.getChecksum());
    }

    @Test
    @DisplayName("7. Chặn chuyển sang READY nếu thiếu checksum hoặc sizeBytes bị âm")
    void testTransitionToReady_MissingIntegrityThrowsException() {
        ObjectRegistry object = ObjectRegistry.builder()
                .id(objectId)
                .state(ObjectState.UPLOADING)
                .ownerId(ownerId)
                .build();

        when(registryRepository.findById(objectId)).thenReturn(Optional.of(object));

        TransitionStateRequest invalidReadyReq = TransitionStateRequest.builder()
                .targetState(ObjectState.READY)
                .sizeBytes(null)
                .checksum(null)
                .build();

        assertThrows(ObjectIntegrityException.class, () -> 
            registryService.transitionState(objectId, invalidReadyReq)
        );
        verify(registryRepository, never()).save(any(ObjectRegistry.class));
    }

    @Test
    @DisplayName("8. Chặn transition không hợp lệ từ DELETED sang trạng thái khác (Terminal State)")
    void testDeletedStateIsTerminal() {
        ObjectRegistry object = ObjectRegistry.builder()
                .id(objectId)
                .state(ObjectState.DELETED)
                .ownerId(ownerId)
                .build();

        when(registryRepository.findById(objectId)).thenReturn(Optional.of(object));

        TransitionStateRequest reviveReq = TransitionStateRequest.builder()
                .targetState(ObjectState.READY)
                .reason("Attempt to revive deleted object")
                .build();

        assertThrows(InvalidStateTransitionException.class, () ->
            registryService.transitionState(objectId, reviveReq)
        );
    }

    @Test
    @DisplayName("9. Liên kết Parent/Child Lineage hoạt động chuẩn xác")
    void testParentChildLineage() {
        UUID parentId = UUID.randomUUID();
        ObjectRegistry parentObj = ObjectRegistry.builder()
                .id(parentId)
                .bucket("smartrec-media")
                .objectKey("meetings/123/original.mp4")
                .artifactType(ArtifactType.ORIGINAL_MEDIA)
                .state(ObjectState.READY)
                .ownerId(ownerId)
                .build();

        ObjectRegistry currentObj = ObjectRegistry.builder()
                .id(objectId)
                .parentObjectId(parentId)
                .bucket("smartrec-media")
                .objectKey("meetings/123/transcript.json")
                .artifactType(ArtifactType.TRANSCRIPT_JSON)
                .state(ObjectState.READY)
                .ownerId(ownerId)
                .build();

        ObjectRegistry childObj = ObjectRegistry.builder()
                .id(UUID.randomUUID())
                .parentObjectId(objectId)
                .bucket("smartrec-media")
                .objectKey("meetings/123/summary.md")
                .artifactType(ArtifactType.SUMMARY_MARKDOWN)
                .state(ObjectState.READY)
                .ownerId(ownerId)
                .build();

        when(registryRepository.findById(objectId)).thenReturn(Optional.of(currentObj));
        when(registryRepository.findById(parentId)).thenReturn(Optional.of(parentObj));
        when(registryRepository.findByParentObjectId(objectId)).thenReturn(List.of(childObj));

        ObjectLineageResponse lineage = registryService.getObjectLineage(objectId);

        assertNotNull(lineage);
        assertEquals(objectId, lineage.getCurrent().getId());
        assertNotNull(lineage.getParent());
        assertEquals(parentId, lineage.getParent().getId());
        assertEquals(1, lineage.getChildren().size());
        assertEquals(childObj.getId(), lineage.getChildren().get(0).getId());
    }

    @Test
    @DisplayName("10. Truy vấn Stale Pending Objects và Orphan Objects")
    void testStalePendingAndOrphanQueries() {
        ObjectRegistry staleObj = ObjectRegistry.builder()
                .id(UUID.randomUUID())
                .bucket("smartrec-media")
                .objectKey("stale.mp4")
                .artifactType(ArtifactType.ORIGINAL_MEDIA)
                .state(ObjectState.PENDING)
                .ownerId(ownerId)
                .createdAt(Instant.now().minus(Duration.ofHours(30)))
                .build();

        when(registryRepository.findStalePendingObjects(any(Instant.class)))
                .thenReturn(List.of(staleObj));
        when(registryRepository.findOrphanObjects())
                .thenReturn(List.of(staleObj));

        List<ObjectRegistryResponse> staleList = registryService.getStalePendingObjects(Duration.ofHours(24));
        assertEquals(1, staleList.size());
        assertEquals(staleObj.getId(), staleList.get(0).getId());

        List<ObjectRegistryResponse> orphanList = registryService.getOrphanObjects();
        assertEquals(1, orphanList.size());
    }

    @Test
    @DisplayName("11. Rollback giao dịch khi gặp lỗi DB lúc lưu Audit Log")
    void testTransactionRollbackOnAuditFailure() {
        ObjectRegistry object = ObjectRegistry.builder()
                .id(objectId)
                .state(ObjectState.PENDING)
                .ownerId(ownerId)
                .build();

        when(registryRepository.findById(objectId)).thenReturn(Optional.of(object));
        when(registryRepository.save(any(ObjectRegistry.class))).thenReturn(object);
        when(auditLogRepository.save(any(ObjectAuditLog.class)))
                .thenThrow(new DataIntegrityViolationException("Simulated audit DB failure"));

        TransitionStateRequest req = TransitionStateRequest.builder()
                .targetState(ObjectState.UPLOADING)
                .reason("Stream started")
                .build();

        assertThrows(DataIntegrityViolationException.class, 
                () -> registryService.transitionState(objectId, req));
    }
}
