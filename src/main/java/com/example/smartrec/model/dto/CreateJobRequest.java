package com.example.smartrec.model.dto;

import java.util.UUID;

import lombok.Data;
import lombok.Getter;
import lombok.AllArgsConstructor;
import lombok.NoArgsConstructor;

@Getter 
@Data 
@AllArgsConstructor
@NoArgsConstructor
public class CreateJobRequest{
    private UUID mediaFileId;
    
}
