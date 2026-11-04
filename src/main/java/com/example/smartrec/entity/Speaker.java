package com.example.smartrec.entity;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "speakers")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Speaker {

    // UUID is assigned during speaker mapping.
    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "meeting_id", nullable = false)
    private UUID meetingId;

    @Column(name = "ai_label", nullable = false, length = 100)
    private String aiLabel;

    @Column(name = "real_name", length = 255)
    private String realName;
}
