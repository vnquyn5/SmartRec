package com.example.smartrec.service.impl;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.ObjectAuditLog;
import com.example.smartrec.entity.ObjectRegistry;
import com.example.smartrec.enums.ObjectState;
import com.example.smartrec.exception.DuplicateObjectKeyException;
import com.example.smartrec.exception.ObjectNotFoundException;
import com.example.smartrec.model.dto.request.RegisterObjectRequest;
import com.example.smartrec.model.dto.request.TransitionStateRequest;
import com.example.smartrec.model.dto.response.ObjectLineageResponse;
import com.example.smartrec.model.dto.response.ObjectRegistryResponse;
import com.example.smartrec.repository.ObjectAuditLogRepository;
import com.example.smartrec.repository.ObjectRegistryRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.ObjectRegistryService;
import com.example.smartrec.service.statemachine.ObjectStateMachine;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
@RequiredArgsConstructor
public class ObjectRegistryServiceImpl implements ObjectRegistryService {

    private final ObjectRegistryRepository registryRepository;
    private final ObjectAuditLogRepository auditLogRepository;
    private final UserRepository userRepository;
    private final ObjectStateMachine stateMachine;

    @Override
    @Transactional
    public ObjectRegistryResponse registerObject(RegisterObjectRequest request) {
      
        if (!userRepository.existsById(request.getOwnerId())) {
            throw new IllegalArgumentException("Cannot create orphan object: Owner with ID " + request.getOwnerId() + " does not exist");
        }

      
        if (request.getParentObjectId() != null && !registryRepository.existsById(request.getParentObjectId())) {
            throw new ObjectNotFoundException(request.getParentObjectId());
        }

       
        Optional<ObjectRegistry> existingOpt = registryRepository.findByBucketAndObjectKey(request.getBucket(), request.getObjectKey());
        if (existingOpt.isPresent()) {
            ObjectRegistry existing = existingOpt.get();
            if (existing.getOwnerId().equals(request.getOwnerId()) 
                    && request.getChecksum() != null 
                    && request.getChecksum().equals(existing.getChecksum())) {
                log.info("Idempotent registration: object already exists with matching checksum for key {}", request.getObjectKey());
                return ObjectRegistryResponse.fromEntity(existing);
            }
            throw new DuplicateObjectKeyException(request.getBucket(), request.getObjectKey());
        }

        
        ObjectState initialState = (request.getSizeBytes() != null && request.getSizeBytes() >= 0 && request.getChecksum() != null)
                ? ObjectState.READY
                : ObjectState.PENDING;

        ObjectRegistry object = ObjectRegistry.builder()
                .bucket(request.getBucket())
                .objectKey(request.getObjectKey())
                .sizeBytes(request.getSizeBytes())
                .checksum(request.getChecksum())
                .mimeType(request.getMimeType())
                .artifactType(request.getArtifactType())
                .state(initialState)
                .ownerId(request.getOwnerId())
                .meetingId(request.getMeetingId())
                .jobId(request.getJobId())
                .parentObjectId(request.getParentObjectId())
                .metadata(request.getMetadata())
                .build();

        try {
            ObjectRegistry saved = registryRepository.save(object);

           
            auditLogRepository.save(ObjectAuditLog.builder()
                    .objectId(saved.getId())
                    .fromState(null)
                    .toState(initialState)
                    .performedBy(request.getOwnerId())
                    .reason("Initial object registration")
                    .contextMetadata(request.getMetadata())
                    .build());

            log.info("Registered object [{}] in state [{}] for bucket/key: {}/{}", 
                     saved.getId(), initialState, saved.getBucket(), saved.getObjectKey());
            return ObjectRegistryResponse.fromEntity(saved);

        } catch (DataIntegrityViolationException ex) {
            log.warn("Concurrent duplicate key detected for bucket: {}, key: {}", request.getBucket(), request.getObjectKey());
            throw new DuplicateObjectKeyException(request.getBucket(), request.getObjectKey());
        }
    }

    @Override
    @Transactional
    public ObjectRegistryResponse transitionState(UUID objectId, TransitionStateRequest request) {
        ObjectRegistry object = registryRepository.findById(objectId)
                .orElseThrow(() -> new ObjectNotFoundException(objectId));

        ObjectState fromState = object.getState();
        ObjectState targetState = request.getTargetState();

        
        if (fromState == targetState) {
            log.info("No-op state transition: object [{}] is already in state [{}]", objectId, targetState);
            return ObjectRegistryResponse.fromEntity(object);
        }

       
        stateMachine.validateTransition(object, request);

       
        stateMachine.executeTransition(object, request);
        ObjectRegistry updated = registryRepository.save(object);

       
        auditLogRepository.save(ObjectAuditLog.builder()
                .objectId(updated.getId())
                .fromState(fromState)
                .toState(targetState)
                .performedBy(request.getPerformedBy())
                .reason(request.getReason())
                .contextMetadata(request.getContextMetadata())
                .build());

        log.info("Object [{}] transitioned: [{}] -> [{}], reason: {}", objectId, fromState, targetState, request.getReason());
        return ObjectRegistryResponse.fromEntity(updated);
    }

    @Override
    @Transactional(readOnly = true)
    public ObjectRegistryResponse getObjectById(UUID objectId) {
        return registryRepository.findById(objectId)
                .map(ObjectRegistryResponse::fromEntity)
                .orElseThrow(() -> new ObjectNotFoundException(objectId));
    }

    @Override
    @Transactional(readOnly = true)
    public ObjectRegistryResponse getByBucketAndKey(String bucket, String key) {
        return registryRepository.findByBucketAndObjectKey(bucket, key)
                .map(ObjectRegistryResponse::fromEntity)
                .orElseThrow(() -> new IllegalArgumentException("Object not found for bucket: " + bucket + " and key: " + key));
    }

    @Override
    @Transactional(readOnly = true)
    public ObjectLineageResponse getObjectLineage(UUID objectId) {
        ObjectRegistry current = registryRepository.findById(objectId)
                .orElseThrow(() -> new ObjectNotFoundException(objectId));

        ObjectRegistryResponse currentDto = ObjectRegistryResponse.fromEntity(current);

        ObjectRegistryResponse parentDto = null;
        if (current.getParentObjectId() != null) {
            parentDto = registryRepository.findById(current.getParentObjectId())
                    .map(ObjectRegistryResponse::fromEntity)
                    .orElse(null);
        }

        List<ObjectRegistryResponse> children = registryRepository.findByParentObjectId(objectId).stream()
                .map(ObjectRegistryResponse::fromEntity)
                .toList();

        return ObjectLineageResponse.builder()
                .current(currentDto)
                .parent(parentDto)
                .children(children)
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ObjectRegistryResponse> getObjectsByMeetingId(UUID meetingId) {
        return registryRepository.findByMeetingId(meetingId).stream()
                .map(ObjectRegistryResponse::fromEntity)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ObjectRegistryResponse> getObjectsByJobId(UUID jobId) {
        return registryRepository.findByJobId(jobId).stream()
                .map(ObjectRegistryResponse::fromEntity)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ObjectRegistryResponse> getStalePendingObjects(Duration olderThan) {
        Instant cutoff = Instant.now().minus(olderThan);
        return registryRepository.findStalePendingObjects(cutoff).stream()
                .map(ObjectRegistryResponse::fromEntity)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ObjectRegistryResponse> getOrphanObjects() {
        return registryRepository.findOrphanObjects().stream()
                .map(ObjectRegistryResponse::fromEntity)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ObjectAuditLog> getAuditLogs(UUID objectId) {
        if (!registryRepository.existsById(objectId)) {
            throw new ObjectNotFoundException(objectId);
        }
        return auditLogRepository.findByObjectIdOrderByCreatedAtDesc(objectId);
    }
}
