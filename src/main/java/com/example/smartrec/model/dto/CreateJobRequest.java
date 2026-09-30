package com.example.smartrec.model.dto;

import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.Getter;

@Getter 
@Data 
public class CreateJobRequest{
    private UUID mediaFileId;
    
}
