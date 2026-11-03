package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.ContextItemDTO;

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
public class ContextPayloadReponse {
    private UUID meetingId;
    private List<ContextItemDTO> contextItems;
    
}
