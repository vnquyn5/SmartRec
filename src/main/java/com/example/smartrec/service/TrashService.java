package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.TrashFilterRequest;
import com.example.smartrec.model.dto.TrashMediaFileResponse;

public interface TrashService {
    PageResponse<TrashMediaFileResponse> findTrash(TrashFilterRequest request);

    TrashMediaFileResponse moveToTrash(UUID mediaFileId);

    TrashMediaFileResponse restore(UUID mediaFileId);

    void permanentDelete(UUID mediaFileId);
}
