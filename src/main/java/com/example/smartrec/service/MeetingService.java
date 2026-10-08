package com.example.smartrec.service;

import java.util.UUID;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

import com.example.smartrec.model.dto.MeetingFilterRequest;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.RenameFileRequest;

public interface MeetingService {
    record MeetingDownloadFile(
            String fileName,
            String mimeType,
            Long fileSizeBytes,
            InputStream inputStream) {
    }

    PageResponse<MeetingResponseDTO> findMeetings(MeetingFilterRequest request);

    void deleteMeeting(UUID meetingId);

    MeetingResponseDTO getMeeting(UUID id);

    MeetingResponseDTO renameMeeting(UUID meetingId, RenameFileRequest request);

    MeetingDownloadFile getDownloadFile(UUID meetingId);

    void writeMeetingsZip(List<UUID> meetingIds, OutputStream outputStream);
}
