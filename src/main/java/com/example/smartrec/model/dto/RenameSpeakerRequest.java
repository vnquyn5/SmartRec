package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;


@Setter 
@Getter 
public class RenameSpeakerRequest {
    @NotBlank(message = "speakerLabel không được để trống")
    @Size (max=50, message="speakerLabel tối đa 50 kí tự")
    private String speakerLabel;

    @NotBlank (message = "Tên mới không được để trống")
    @Size (max = 50,message = "Tên mới tối đa 50 kí tự ")
    private String newName;
    
}
