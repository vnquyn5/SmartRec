package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.impl.AIModelRouter;
import com.example.smartrec.config.SecurityConfig;
import com.example.smartrec.exception.GlobalExceptionHandler;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.security.JwtAuthenticationFilter;
import com.example.smartrec.security.JwtService;

@ExtendWith(SpringExtension.class)
@WebAppConfiguration
@ContextConfiguration(classes = AIInferenceControllerTest.Config.class)
@TestPropertySource(properties = {
        "smartrec.internal-token=test-internal", "app.cors.allowed-origins=http://localhost:5173"
})
class AIInferenceControllerTest {
    @Configuration
    @EnableWebMvc
    @Import({SecurityConfig.class, AIInferenceController.class, GlobalExceptionHandler.class})
    static class Config {
        @Bean AIModelRouter router() { return mock(AIModelRouter.class); }
        @Bean JwtAuthenticationFilter jwtFilter() {
            return new JwtAuthenticationFilter(mock(JwtService.class), mock(UserRepository.class));
        }
    }

    @Autowired WebApplicationContext context;

    @Test
    void llmDisabledRejectsDirectRouterCallsAfterAuthentication() {
        AIModelRouter router = mock(AIModelRouter.class);
        AIInferenceController controller = new AIInferenceController(router);
        ReflectionTestUtils.setField(controller, "configuredInternalToken", "test-token");
        ReflectionTestUtils.setField(controller, "llmEnabled", false);

        assertThrows(BusinessException.class, () -> controller.generateAIResult(
                UUID.randomUUID(), UUID.randomUUID(), "test-token"));
        verifyNoInteractions(router);
    }

    @Test
    void missingExecutionHeaderReturnsStructuredBadRequest() throws Exception {
        var mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        mvc.perform(post("/internal/jobs/{jobId}/ai-result", UUID.randomUUID())
                        .header("X-Internal-Token", "test-internal"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MISSING_REQUIRED_HEADER"));
    }

    @Test
    void malformedExecutionHeaderReturnsBadRequest() throws Exception {
        var mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        mvc.perform(post("/internal/jobs/{jobId}/ai-result", UUID.randomUUID())
                        .header("X-Execution-Id", "not-a-uuid")
                        .header("X-Internal-Token", "test-internal"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER_FORMAT"));
    }

    @Test
    void validExecutionHeaderStillRequiresInternalToken() throws Exception {
        var mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        mvc.perform(post("/internal/jobs/{jobId}/ai-result", UUID.randomUUID())
                        .header("X-Execution-Id", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_INTERNAL_TOKEN"));
    }
}
