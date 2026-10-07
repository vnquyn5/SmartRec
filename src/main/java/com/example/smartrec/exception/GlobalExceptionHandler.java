package com.example.smartrec.exception;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log =
            LoggerFactory.getLogger(GlobalExceptionHandler.class);

    // 401 - Sai email/phone/password
    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ErrorResponseDTO> handleBadCredentials(
            BadCredentialsException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode("INVALID_CREDENTIALS");
        errorResponseDTO.setMessage(
                "Email hoặc số điện thoại hoặc mật khẩu không đúng"
        );
        errorResponseDTO.setDetail(List.of());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(HttpStatus.UNAUTHORIZED)
                .body(errorResponseDTO);
    }

    // 400 - Validation error
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponseDTO> handleValidationException(
            MethodArgumentNotValidException ex) {

        List<String> detail = new ArrayList<>();

        ex.getBindingResult()
                .getFieldErrors()
                .forEach(error ->
                        detail.add(
                                error.getField()
                                        + ": "
                                        + error.getDefaultMessage()
                        )
                );

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode("VALIDATION_ERROR");
        errorResponseDTO.setMessage("Dữ liệu không hợp lệ");
        errorResponseDTO.setDetail(detail);
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(errorResponseDTO);
    }

    // Business exception
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponseDTO> handleBusinessException(
            BusinessException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode(ex.getCode());
        errorResponseDTO.setMessage(ex.getMessage());
        errorResponseDTO.setDetail(ex.getDetail());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(ex.getStatus())
                .body(errorResponseDTO);
    }

    // MinIO exception
    @ExceptionHandler(MinioOperationException.class)
    public ResponseEntity<ErrorResponseDTO> handleMinioOperation(
            MinioOperationException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode(ex.getCode());
        errorResponseDTO.setMessage(ex.getMessage());
        errorResponseDTO.setDetail(List.of());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(ex.getStatus())
                .body(errorResponseDTO);
    }

    // 404
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponseDTO> handleResourceNotFound(
            ResourceNotFoundException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode(ex.getCode());
        errorResponseDTO.setMessage(ex.getMessage());
        errorResponseDTO.setDetail(List.of());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(errorResponseDTO);
    }

    // 413 - File quá lớn
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ErrorResponseDTO> handleMaxUploadSizeExceeded(
            MaxUploadSizeExceededException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode("ERR_FILE_TOO_LARGE");
        errorResponseDTO.setMessage("File vượt quá dung lượng cho phép");
        errorResponseDTO.setDetail(List.of());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(errorResponseDTO);
    }

    // 400 - Thiếu multipart part
    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<ErrorResponseDTO> handleMissingPart(
            MissingServletRequestPartException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode("MISSING_PARAMETER");
        errorResponseDTO.setMessage(
                "Thiếu phần dữ liệu bắt buộc: "
                        + ex.getRequestPartName()
        );
        errorResponseDTO.setDetail(List.of());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(errorResponseDTO);
    }

    // 400 - Thiếu request parameter
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ErrorResponseDTO> handleMissingParameter(
            MissingServletRequestParameterException ex) {

        ErrorResponseDTO errorResponseDTO = new ErrorResponseDTO();
        errorResponseDTO.setCode("MISSING_PARAMETER");
        errorResponseDTO.setMessage(
                "Thiếu tham số bắt buộc: "
                        + ex.getParameterName()
        );
        errorResponseDTO.setDetail(List.of());
        errorResponseDTO.setTimestamp(LocalDateTime.now());

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(errorResponseDTO);
    }

    // 500 - Exception không xác định
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponseDTO> handleException(
            Exception ex) {

        log.error("Unhandled backend exception", ex);

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