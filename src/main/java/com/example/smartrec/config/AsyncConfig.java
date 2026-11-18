package com.example.smartrec.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration 

public class AsyncConfig {
     @Bean(name = "applicationTaskExecutor")
    public TaskExecutor applicationTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();

        // Số luồng xử lý mặc định
        executor.setCorePoolSize(4);

        // Số luồng tối đa
        executor.setMaxPoolSize(8);

        // Số tác vụ được phép chờ
        executor.setQueueCapacity(100);

        // Đặt tên cho các luồng
        executor.setThreadNamePrefix("file-task-");

        return executor;
    }

    @Bean(name = "jobProgressTaskExecutor")
    public TaskExecutor jobProgressTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("job-progress-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(5);
        return executor;
    }

    @Bean(name = "jobDispatchTaskExecutor")
    public TaskExecutor jobDispatchTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("job-dispatch-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        return executor;
    }

    @Bean(name = "jobDispatchRetryScheduler")
    public JobDispatchRetryScheduler jobDispatchRetryScheduler() {
        return new JobDispatchRetryScheduler();
    }
}
