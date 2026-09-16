package com.example.smartrec.exception;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

        // 400
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Object> handleValidationException(
            MethodArgumentNotValidException ex) {

        List<String> detail = new ArrayList<>();
        ex.getBindingResult()
                .getFieldErrors()
                .forEach(error -> {
                    detail.add(
                            error.getField()
                                    + ": "
                                    + error.getDefaultMessage());

                });
        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode("VALIDATION_ERROR");
        errorResponseDTO.setMessage("dữ liệu không hợp lê");
        errorResponseDTO.setDetail(detail);
        errorResponseDTO.setTimestamp(LocalDateTime.now());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponseDTO);
    }

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<Object> handleBusinessException(
            BusinessException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode(ex.getCode());
        errorResponseDTO.setMessage(ex.getMessage());
        errorResponseDTO.setDetail(new ArrayList<>());
        errorResponseDTO.setTimestamp(LocalDateTime.now());
        return ResponseEntity.status(ex.getStatus()).body(errorResponseDTO);
    }

    // 404
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponseDTO> handleResourceNotFound(
            ResourceNotFoundException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();

        errorResponseDTO.setCode(ex.getCode());
        errorResponseDTO.setMessage(ex.getMessage());
        errorResponseDTO.setDetail(new ArrayList<>());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(errorResponseDTO);
    }
    // 500
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponseDTO> handleException(
            Exception ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();

        errorResponseDTO.setCode("INTERNAL_SERVER_ERROR");
        errorResponseDTO.setMessage("Đã xảy ra lỗi hệ thống");
        errorResponseDTO.setDetail(List.of());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(errorResponseDTO);
    }
}
