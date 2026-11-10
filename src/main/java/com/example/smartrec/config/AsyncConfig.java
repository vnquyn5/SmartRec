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
}
