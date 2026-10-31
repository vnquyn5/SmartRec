package com.example.smartrec.service;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import com.example.smartrec.entity.ObjectAuditLog;
import com.example.smartrec.model.dto.request.RegisterObjectRequest;
import com.example.smartrec.model.dto.request.TransitionStateRequest;
import com.example.smartrec.model.dto.response.ObjectLineageResponse;
import com.example.smartrec.model.dto.response.ObjectRegistryResponse;

public interface ObjectRegistryService {

    ObjectRegistryResponse registerObject(RegisterObjectRequest request);

    ObjectRegistryResponse transitionState(UUID objectId, TransitionStateRequest request);

    ObjectRegistryResponse getObjectById(UUID objectId);

    ObjectRegistryResponse getByBucketAndKey(String bucket, String key);

    ObjectLineageResponse getObjectLineage(UUID objectId);

    List<ObjectRegistryResponse> getObjectsByMeetingId(UUID meetingId);

    List<ObjectRegistryResponse> getObjectsByJobId(UUID jobId);

    List<ObjectRegistryResponse> getStalePendingObjects(Duration olderThan);

    List<ObjectRegistryResponse> getOrphanObjects();

    List<ObjectAuditLog> getAuditLogs(UUID objectId);
}
