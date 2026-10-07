package com.example.smartrec.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.Comment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "speaker_segments")
@Setter
@Getter
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class SpeakerSegment {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "meeting_id", nullable = false)
    private UUID meetingId;

    @Column(name = "speaker_label", nullable = false, length = 100)
    private String speakerLabel;

    @Column(name = "start_time", nullable = false)
    private Double startTime;

    @Column(name = "end_time", nullable = false)
    private Double endTime;

}
