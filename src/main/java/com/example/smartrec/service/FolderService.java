package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.dto.FolderRequest;
import com.example.smartrec.model.dto.FolderResponse;
import com.example.smartrec.model.dto.MoveMeetingsRequest;
import com.example.smartrec.model.dto.MoveMeetingsResponse;

public interface FolderService {
    List<FolderResponse> getFolders(String parentId);

    FolderResponse createFolder(FolderRequest request);

    FolderResponse renameFolder(UUID folderId, FolderRequest request);

    MoveMeetingsResponse moveMeetings(MoveMeetingsRequest request);
}
