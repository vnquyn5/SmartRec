package com.example.smartrec.controller;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.*;
import org.springframework.http.MediaType;
import org.springframework.test.context.*;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import com.example.smartrec.config.SecurityConfig;
import com.example.smartrec.security.*;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.MeetingSlideService;

@ExtendWith(SpringExtension.class)
@WebAppConfiguration
@ContextConfiguration(classes = MeetingSlideSecurityTest.Config.class)
@TestPropertySource(properties = {
    "smartrec.internal-token=test-internal", "app.cors.allowed-origins=http://localhost:5173"
})
class MeetingSlideSecurityTest {
    @Configuration @EnableWebMvc
    @Import({SecurityConfig.class, MeetingSlideController.class})
    static class Config {
        @Bean MeetingSlideService slides() { return mock(MeetingSlideService.class); }
        @Bean JwtAuthenticationFilter jwtFilter() {
            return new JwtAuthenticationFilter(mock(JwtService.class), mock(UserRepository.class));
        }
    }
    @Autowired WebApplicationContext context;

    @Test void metadataRequiresInternalTokenWhileReadStillRequiresJwt() throws Exception {
        var mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        var meeting = UUID.randomUUID();
        var base = "/meetings/" + meeting + "/slides";
        var body = """
            {"slideId":"%s","meetingId":"%s","jobId":"%s","timestampMs":0,
             "objectKey":"meetings/%s/jobs/test/ocr/slide.jpg"}
            """.formatted(UUID.randomUUID(), meeting, UUID.randomUUID(), meeting);
        mvc.perform(post(base + "/metadata").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isUnauthorized());
        mvc.perform(post(base + "/metadata").header("X-Internal-Token", "wrong")
            .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
        mvc.perform(post(base + "/metadata").header("X-Internal-Token", "test-internal")
            .header("X-Execution-Id", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated());
        mvc.perform(get(base).header("X-Internal-Token", "test-internal")).andExpect(status().isForbidden());
        mvc.perform(post(base + "/metadata").header("X-Internal-Token", "test-internal")
            .contentType(MediaType.APPLICATION_JSON).content(body.replace("\"timestampMs\":0", "\"timestampMs\":-1")))
            .andExpect(status().isBadRequest());
    }
}
