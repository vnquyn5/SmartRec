package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class TranscriptRequest {
    private UUID meetingId; // cuoc hop can luu trong Transcript
    private UUID processingJobId; // job AI thuc hien nhan dang dong noi
    private List<TranscriptItemRequest>transcripts; // danh sach AI tra ve
}
