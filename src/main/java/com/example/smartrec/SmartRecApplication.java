package com.example.smartrec;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SmartRecApplication {

    public static void main(String[] args) {
        SpringApplication.run(SmartRecApplication.class, args);
    }

}
