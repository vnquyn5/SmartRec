package com.example.smartrec.exception;

import java.time.LocalDateTime;
import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data   
@AllArgsConstructor 
@NoArgsConstructor                
public class ErrorResponseDTO {
     private String code;

    private String message;

    private List<String> detail;

    private LocalDateTime timestamp;
}
