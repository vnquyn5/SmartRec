package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import com.example.smartrec.model.dto.MeetingSlideMetadataRequest;
import com.example.smartrec.service.MeetingSlideService;

class MeetingSlideControllerTest {
    @Test void tokenRequiredEvenWithoutJwt() {
        var service = mock(MeetingSlideService.class);
        var controller = new MeetingSlideController(service);
        ReflectionTestUtils.setField(controller, "configuredInternalToken", "test-internal");
        var request = new MeetingSlideMetadataRequest();
        var meeting = UUID.randomUUID();
        var execution = UUID.randomUUID();
        ReflectionTestUtils.setField(request, "meetingId", meeting);
        for (String token : new String[]{null, "", "incorrect"}) {
            assertEquals(401, assertThrows(ResponseStatusException.class,
                () -> controller.saveMetadata(meeting, token, execution, request)).getStatusCode().value());
        }
        verifyNoInteractions(service);
        assertEquals(400, controller.saveMetadata(UUID.randomUUID(), "test-internal", execution, request).getStatusCode().value());
        controller.saveMetadata(meeting, "test-internal", execution, request);
        verify(service).saveMetaData(request, execution);
        ReflectionTestUtils.setField(controller, "configuredInternalToken", "");
        assertThrows(ResponseStatusException.class,
            () -> controller.saveMetadata(meeting, "test-internal", execution, request));
    }
}
