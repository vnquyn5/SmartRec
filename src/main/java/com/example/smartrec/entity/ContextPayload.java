package com.example.smartrec.entity;



import java.sql.SQLType;

import java.util.Map;

import java.util.UUID;



import org.hibernate.annotations.JdbcType;

import org.hibernate.annotations.JdbcTypeCode;

import org.hibernate.type.SqlTypes;



import com.google.auto.value.AutoValue.Builder;



import jakarta.persistence.Column;

import jakarta.persistence.Entity;

import jakarta.persistence.GeneratedValue;

import jakarta.persistence.GenerationType;

import jakarta.persistence.Id;

import jakarta.persistence.Table;

import lombok.AllArgsConstructor;

import lombok.Getter;

import lombok.NoArgsConstructor;

import lombok.Setter;



@Entity

@Table (name = "context_payloads")

@Getter

@Setter

@Builder

@AllArgsConstructor

@NoArgsConstructor

public class ContextPayload {

    @Id

    @GeneratedValue(strategy = GenerationType.UUID)

    private UUID id;



    @Column (name = "meeting_id")

    private UUID meetingId;



    @JdbcTypeCode (SqlTypes.JSON)

    @Column (name = "payload",columnDefinition = "jsonb",nullable = false)

    private Map<String,Object> payload;



}
