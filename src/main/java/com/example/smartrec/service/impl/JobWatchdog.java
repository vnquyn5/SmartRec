package com.example.smartrec.service.impl;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.example.smartrec.service.JobService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Component
@RequiredArgsConstructor
@Slf4j
public class JobWatchdog {
    private final JobService jobService;

    @Scheduled(fixedDelayString = "${job.watchdog-scan-interval-ms:30000}")
    public void failStaleJobs() {
        try {
            jobService.markStaleJobsFailed();
        } catch (RuntimeException exception) {
            log.error("Job watchdog scan failed", exception);
        }
    }
}
