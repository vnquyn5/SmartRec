package com.example.smartrec.util;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class MediaUploadPolicyTest {
    @Test
    void acceptsOnlySupportedExtensionsAndMatchingMimeTypes() {
        assertTrue(MediaUploadPolicy.isMimeTypeCompatible("meeting.mp4", "video/mp4"));
        assertTrue(MediaUploadPolicy.isMimeTypeCompatible("meeting.mkv", "application/octet-stream"));
        assertTrue(MediaUploadPolicy.isMimeTypeCompatible("meeting.mp3", null));
        assertTrue(MediaUploadPolicy.isMimeTypeCompatible("meeting.m4a", "audio/mp4"));
        assertFalse(MediaUploadPolicy.isMimeTypeCompatible("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
        assertFalse(MediaUploadPolicy.isMimeTypeCompatible("meeting.mp4", "audio/mpeg"));
        assertFalse(MediaUploadPolicy.isMimeTypeCompatible("meeting.mp3", "application/pdf"));
    }

    @Test
    void verifiesKnownMediaContainerSignatures() {
        assertTrue(MediaUploadPolicy.hasSupportedSignature("a.mp4", header("....ftypisom")));
        assertTrue(MediaUploadPolicy.hasSupportedSignature("a.m4a", header("....ftypM4A ")));
        assertTrue(MediaUploadPolicy.hasSupportedSignature("a.mkv", new byte[] { 0x1a, 0x45, (byte) 0xdf, (byte) 0xa3 }));
        assertTrue(MediaUploadPolicy.hasSupportedSignature("a.mp3", header("ID3")));
        assertFalse(MediaUploadPolicy.hasSupportedSignature("a.mp4", header("PK\u0003\u0004")));
        assertFalse(MediaUploadPolicy.hasSupportedSignature("a.pdf", header("%PDF-1.7")));
    }

    private byte[] header(String value) {
        return value.getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
    }
}
