package com.example.smartrec.model;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter 
@Setter 
@AllArgsConstructor 
@NoArgsConstructor 
public class ContextItemDTO {
    private Long start;

    private Long end;

    private String speaker;

    private String transcript;

    private String slideText;

    private Long slideTimestamp;
    
}
