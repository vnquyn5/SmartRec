package com.example.smartrec.service.impl;

import java.util.UUID;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.example.smartrec.service.JobQueueService;

import lombok.RequiredArgsConstructor;


@Service 
@RequiredArgsConstructor 
public class JobQueueServiceImpl implements JobQueueService {
    private static final String JOB_QUEUE = "smartrec:job:queue";
    private static  final String RETRY_QUEUE = "smartrec:retry:queue";
    private static final String DLQ_QUEUE = "smartrec:job:dlq";
    private final StringRedisTemplate redisTemplate;

    // dua job moi vao main queue
    @Override 
    public void enqueueJob(UUID jobId){
        redisTemplate.opsForList()// noi voi redis la toi muon thao tac voi kieu du lieu list trong redis
                                 .rightPush(JOB_QUEUE, jobId.toString());   
    }

    // dua job vao retry queue
    @Override 
    public void enqueueRetry(UUID jobId){
        redisTemplate.opsForList()
                                 .rightPush(RETRY_QUEUE,jobId.toString());
    }

    // dua job vao DQL
    @Override 
    public void enqueueDLQ(UUID jobId){
        redisTemplate.opsForList()  
                                 .rightPush(DLQ_QUEUE, jobId.toString());
    }

    
    // lay job tu main queue
    @Override 
    public String pollJob(){
        // lay api thao tc voi redis list
        return  redisTemplate.opsForList()
                                        .leftPop(JOB_QUEUE);// lay phan tu dau tien ra khoi list dong thoi xoa no khoi list
    }

    // lay job tu retry queue
    @Override 
    public String pollRetryJob(){
        return redisTemplate.opsForList()
                                        .leftPop(RETRY_QUEUE);
    }

    // lay job tu DQL 
    @Override 
    public String pollDLQ(){
        return redisTemplate.opsForList()
                                        .leftPop(DLQ_QUEUE);
    }
    
}
