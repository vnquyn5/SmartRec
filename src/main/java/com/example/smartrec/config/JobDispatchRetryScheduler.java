package com.example.smartrec.config;

import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import jakarta.annotation.PreDestroy;

/** Dedicated delayed-retry scheduler, kept separate from Spring's reliability schedules. */
public class JobDispatchRetryScheduler {
    private final ScheduledThreadPoolExecutor executor;

    public JobDispatchRetryScheduler() {
        AtomicInteger threadNumber = new AtomicInteger();
        ThreadFactory threadFactory = task -> {
            Thread thread = new Thread(task, "job-dispatch-retry-" + threadNumber.incrementAndGet());
            thread.setDaemon(false);
            return thread;
        };
        executor = new ScheduledThreadPoolExecutor(1, threadFactory);
        executor.setRemoveOnCancelPolicy(true);
    }

    public ScheduledFuture<?> schedule(Runnable task, long delay, TimeUnit unit) {
        return executor.schedule(task, delay, unit);
    }

    @PreDestroy
    public void shutdown() {
        executor.shutdown();
    }
}
