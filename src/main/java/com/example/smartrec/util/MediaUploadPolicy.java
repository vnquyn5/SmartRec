package com.example.smartrec.util;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class MediaUploadPolicy {
    private static final Map<String, Set<String>> MIME_TYPES = Map.of(
            "mp4", Set.of("video/mp4", "application/mp4"),
            "mkv", Set.of("video/x-matroska", "video/matroska", "application/x-matroska"),
            "mp3", Set.of("audio/mpeg", "audio/mp3", "audio/x-mpeg", "audio/x-mp3"),
            "m4a", Set.of("audio/mp4", "audio/m4a", "audio/x-m4a"));

    private MediaUploadPolicy() {}

    public static String extensionOf(String fileName) {
        if (fileName == null) return "";
        int dot = fileName.lastIndexOf('.');
        return dot < 0 ? "" : fileName.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    public static boolean isSupportedExtension(String fileName) {
        return MIME_TYPES.containsKey(extensionOf(fileName));
    }

    public static boolean isMimeTypeCompatible(String fileName, String mimeType) {
        String mime = mimeType == null ? "" : mimeType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (mime.isEmpty() || mime.equals("application/octet-stream")) return isSupportedExtension(fileName);
        return MIME_TYPES.getOrDefault(extensionOf(fileName), Set.of()).contains(mime);
    }

    public static boolean hasSupportedSignature(String fileName, byte[] header) {
        if (header == null) return false;
        return switch (extensionOf(fileName)) {
            case "mkv" -> header.length >= 4
                    && (header[0] & 0xff) == 0x1a && (header[1] & 0xff) == 0x45
                    && (header[2] & 0xff) == 0xdf && (header[3] & 0xff) == 0xa3;
            case "mp4", "m4a" -> header.length >= 8
                    && header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p';
            case "mp3" -> hasMp3Signature(header);
            default -> false;
        };
    }

    private static boolean hasMp3Signature(byte[] header) {
        if (header.length >= 3 && header[0] == 'I' && header[1] == 'D' && header[2] == '3') return true;
        return header.length >= 2 && (header[0] & 0xff) == 0xff && (header[1] & 0xe0) == 0xe0;
    }
}
