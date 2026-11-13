package com.example.smartrec.model.dto;

import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;


@Setter 
@Getter 
public class RenameSpeakerRequest {
    /** Immutable meeting-scoped speaker identity; preferred by current clients. */
    private UUID speakerId;

    /** Legacy selector accepted for older clients. */
    @Size(max = 100, message = "speakerLabel tối đa 100 kí tự")
    private String speakerLabel;

    @NotBlank (message = "Tên mới không được để trống")
    @Size (max = 50,message = "Tên mới tối đa 50 kí tự ")
    private String newName;
    
}
