package com.example.smartrec.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component 
@ConfigurationProperties(prefix = "media")
public class MediaProperties {
     private long maxDurationHours;

    public long getMaxDurationHours() {
        return maxDurationHours;
    }

    public void setMaxDurationHours(long maxDurationHours) {
        this.maxDurationHours = maxDurationHours;
    }

    public long getMaxDurationSeconds() {
        return maxDurationHours * 60 * 60;
    }
}
