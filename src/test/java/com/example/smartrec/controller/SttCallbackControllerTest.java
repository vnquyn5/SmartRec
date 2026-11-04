package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import com.example.smartrec.config.SttProperties;
import com.example.smartrec.model.dto.SttResultRequest;
import com.example.smartrec.service.SttService;

class SttCallbackControllerTest {
    @Test
    void tokenAuthenticationPrecedesServiceAndExecutionIsForwarded() {
        var service = mock(SttService.class);
        var properties = new SttProperties();
        properties.getAiEngine().setInternalToken("internal-test");
        var controller = new SttCallbackController(service, properties);
        var request = new SttResultRequest();
        var execution = UUID.randomUUID();
        for (String token : new String[]{null, "", "incorrect"}) {
            assertEquals(401, assertThrows(ResponseStatusException.class,
                    () -> controller.receiveResult(token, execution, request)).getStatusCode().value());
        }
        verifyNoInteractions(service);
        controller.receiveResult("internal-test", execution, request);
        verify(service).receiveResult(request, execution);
    }

    @Test
    void unconfiguredTokenNeverAuthenticates() {
        var service = mock(SttService.class);
        var controller = new SttCallbackController(service, new SttProperties());
        assertThrows(ResponseStatusException.class,
                () -> controller.receiveResult("internal-test", null, new SttResultRequest()));
        verifyNoInteractions(service);
    }
}
