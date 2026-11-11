package com.example.smartrec.service;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import org.springframework.http.HttpStatus;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;

/**
 * Validates lifecycle transitions on the existing persisted Job and JobStage
 * state.
 */
public class JobStateMachine {
        private static final Map<JobStatus, Set<JobStatus>> JOB_TRANSITIONS = new EnumMap<>(JobStatus.class);
        private static final Map<JobStageStatus, Set<JobStageStatus>> STAGE_TRANSITIONS = new EnumMap<>(
                        JobStageStatus.class);

        static {
                allow(JOB_TRANSITIONS, JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.PAUSED,
                                JobStatus.CANCELLED, JobStatus.CANCEL_REQUESTED);
                allow(JOB_TRANSITIONS, JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.RUNNING, JobStatus.RETRYING,
                                JobStatus.PAUSED, JobStatus.PAUSE_REQUESTED, JobStatus.CANCELLED,
                                JobStatus.CANCEL_REQUESTED);
                allow(JOB_TRANSITIONS, JobStatus.RUNNING, JobStatus.PROCESSING, JobStatus.QUEUED, JobStatus.RETRYING,
                                JobStatus.PAUSE_REQUESTED, JobStatus.CANCEL_REQUESTED, JobStatus.FAILED, JobStatus.DLQ,
                                JobStatus.PAUSED, JobStatus.CANCELLED, JobStatus.COMPLETED);
                allow(JOB_TRANSITIONS, JobStatus.PROCESSING, JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRYING,
                                JobStatus.PAUSE_REQUESTED, JobStatus.CANCEL_REQUESTED, JobStatus.FAILED, JobStatus.DLQ,
                                JobStatus.PAUSED, JobStatus.CANCELLED, JobStatus.COMPLETED);
                allow(JOB_TRANSITIONS, JobStatus.RETRYING, JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.RUNNING,
                                JobStatus.PAUSE_REQUESTED, JobStatus.CANCEL_REQUESTED, JobStatus.FAILED, JobStatus.DLQ,
                                JobStatus.PAUSED, JobStatus.CANCELLED, JobStatus.COMPLETED);
                allow(JOB_TRANSITIONS, JobStatus.PAUSE_REQUESTED, JobStatus.PAUSED, JobStatus.PROCESSING,
                                JobStatus.QUEUED, JobStatus.RETRYING, JobStatus.CANCEL_REQUESTED, JobStatus.CANCELLED,
                                JobStatus.FAILED);
                allow(JOB_TRANSITIONS, JobStatus.PAUSED, JobStatus.QUEUED, JobStatus.CANCELLED, JobStatus.RETRYING);
                allow(JOB_TRANSITIONS, JobStatus.CANCEL_REQUESTED, JobStatus.CANCELLED, JobStatus.FAILED,
                                JobStatus.RETRYING);
                allow(JOB_TRANSITIONS, JobStatus.FAILED, JobStatus.RETRYING, JobStatus.DLQ);
                allow(JOB_TRANSITIONS, JobStatus.DLQ, JobStatus.RETRYING);
                allow(JOB_TRANSITIONS, JobStatus.CANCELLED, JobStatus.RETRYING);
                allow(JOB_TRANSITIONS, JobStatus.COMPLETED);

                allow(STAGE_TRANSITIONS, JobStageStatus.PENDING, JobStageStatus.PROCESSING, JobStageStatus.FAILED,
                                JobStageStatus.PAUSED, JobStageStatus.CANCELLED, JobStageStatus.SKIPPED);
                allow(STAGE_TRANSITIONS, JobStageStatus.PROCESSING, JobStageStatus.SUCCESS, JobStageStatus.FAILED,
                                JobStageStatus.RETRYING, JobStageStatus.PAUSED, JobStageStatus.CANCELLED);
                allow(STAGE_TRANSITIONS, JobStageStatus.FAILED, JobStageStatus.RETRYING, JobStageStatus.PENDING);
                allow(STAGE_TRANSITIONS, JobStageStatus.RETRYING, JobStageStatus.PROCESSING, JobStageStatus.PENDING,
                                JobStageStatus.FAILED, JobStageStatus.PAUSED, JobStageStatus.CANCELLED);
                allow(STAGE_TRANSITIONS, JobStageStatus.PAUSED, JobStageStatus.PENDING, JobStageStatus.CANCELLED);
                allow(STAGE_TRANSITIONS, JobStageStatus.SUCCESS);
                allow(STAGE_TRANSITIONS, JobStageStatus.CANCELLED, JobStageStatus.PENDING);
                allow(STAGE_TRANSITIONS, JobStageStatus.SKIPPED, JobStageStatus.PENDING);
        }

        private static <S extends Enum<S>> void allow(Map<S, Set<S>> graph, S from, S... to) {
                graph.put(from, to.length == 0 ? EnumSet.noneOf(from.getDeclaringClass()) : EnumSet.of(to[0], to));
        }

        public void transition(Job job, JobStatus next) {
                if (job == null || next == null)
                        throw invalid("Job transition requires current and target states");
                JobStatus current = job.getStatus();
                if (current == next)
                        return;
                if (current == null || !JOB_TRANSITIONS.getOrDefault(current, Set.of()).contains(next)) {
                        throw invalid("Invalid Job transition: " + current + " -> " + next);
                }
                job.setStatus(next);
        }

        public void transition(JobStage stage, JobStageStatus next) {
                if (stage == null || next == null)
                        throw invalid("JobStage transition requires current and target states");
                JobStageStatus current = stage.getStatus();
                if (current == next)
                        return;
                if (current == null || !STAGE_TRANSITIONS.getOrDefault(current, Set.of()).contains(next)) {
                        throw invalid("Invalid JobStage transition: " + current + " -> " + next);
                }
                stage.setStatus(next);
        }

        private static BusinessException invalid(String message) {
                return new BusinessException(HttpStatus.CONFLICT, "INVALID_STATE_TRANSITION", message);
        }
}
