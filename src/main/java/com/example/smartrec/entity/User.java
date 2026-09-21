package com.example.smartrec.entity;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity 
@Table ( name = "users")
@Builder 
@AllArgsConstructor 
@NoArgsConstructor 
@Getter 
@Setter 
public class User {

    @Id 
    @GeneratedValue(strategy = GenerationType.UUID)
    private  UUID id;

    @Column(name = "user_code", unique = true, nullable = false, length = 30)
    private String userCode;

    @Column (name ="email" , unique = true)
    private String email;

    @Column(name="phone",unique = true)
    private String phone;

    @Column (name = "password_hash" , nullable = false)
    private String password_hash;

    @Column (name ="full_name" , nullable = false)
    private String full_name;

    @Column(name = "department")
    private String department;

    @Column(name = "position")
    private String position;

    @Column (name = "is_active")
    private Boolean is_active = true;

    @CreationTimestamp 
    @Column (name = "created_at", updatable = false)
    private Instant created_at;

    @UpdateTimestamp 
    @Column (name = "updated_at")
    private Instant updated_at;

    @Column (name = "delete_at")
    private Instant delete_at;

    @PrePersist
    public void generateUserCodeIfNeeded() {
        if (userCode == null || userCode.isBlank()) {
            String date = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
            String suffix = String.format("%04d", ThreadLocalRandom.current().nextInt(10000));
            this.userCode = "SMR" + date + suffix;
        }
    }
}
