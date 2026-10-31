package com.example.smartrec.model.dto.request;

import java.util.UUID;

import com.example.smartrec.enums.ObjectState;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TransitionStateRequest {

    @NotNull(message = "Target state is required")
    private ObjectState targetState;

    private UUID performedBy;

    @Size(max = 500, message = "Reason must not exceed 500 characters")
    private String reason;

    private Long sizeBytes;
    private String checksum;
    private String contextMetadata;
}
