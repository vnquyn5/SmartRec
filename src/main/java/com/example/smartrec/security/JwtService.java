package com.example.smartrec.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.util.List;
import java.util.Date;
import java.util.UUID;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import com.example.smartrec.entity.PublicShareLink;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

    private final Key signingKey;

    public JwtService(@Value("${jwt.secret}") String secret) {
        this.signingKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public Claims parseClaims(String token) {
        return Jwts.parserBuilder()
                .setSigningKey(signingKey)
                .build()
                .parseClaimsJws(token)
                .getBody();
    }

    // Tạo phiên Guest bằng chính signing key đang dùng cho JWT của ứng dụng.
    public String generateGuestToken(UUID shareLinkId, UUID meetingId, String passcodeHash, Date expiresAt) {
        Date now = new Date(); // Ghi thời điểm phát hành theo UTC epoch của Java Date.
        return Jwts.builder()
                .setId(UUID.randomUUID().toString()) // jti riêng để có thể định danh phiên trong tương lai.
                .setSubject("guest:" + shareLinkId) // Subject tách biệt với email/định danh của Owner.
                .claim("type", "GUEST") // Filter dựa claim này để không coi Guest là Owner.
                .claim("shareLinkId", shareLinkId.toString()) // Gắn phiên với đúng Public Share Link.
                .claim("meetingId", meetingId.toString()) // Gắn phiên với đúng Meeting do link chia sẻ.
                .claim("scope", List.of("meeting:read")) // Token chỉ khai báo phạm vi đọc.
                .claim("passcodeVersion", passcodeVersion(passcodeHash))
                .setIssuedAt(now) // Đặt thời gian phát hành vào claim iat.
                .setExpiration(expiresAt) // Hết hạn theo TTL cấu hình, đã bị giới hạn bởi expiry của link.
                .signWith(signingKey) // Ký để backend xác minh tính toàn vẹn bằng secret hiện có.
                .compact(); // Tuần tự hóa header, claims và chữ ký thành chuỗi JWT.
    }

    public Claims requireGuestClaims(String token, PublicShareLink link) {
        Claims claims = parseClaims(token);
        Date now = new Date();
        if (!"GUEST".equals(claims.get("type"))
                || !List.of("meeting:read").equals(claims.get("scope"))
                || !link.getId().toString().equals(claims.get("shareLinkId"))
                || !link.getMeetingId().toString().equals(claims.get("meetingId"))
                || !("guest:" + link.getId()).equals(claims.getSubject())
                || !passcodeVersion(link.getPasscodeHash()).equals(claims.get("passcodeVersion"))
                || claims.getIssuedAt() == null || claims.getIssuedAt().after(now)
                || claims.getExpiration() == null || !claims.getExpiration().after(now)) {
            throw new IllegalArgumentException("Invalid guest session");
        }
        return claims;
    }

    private static String passcodeVersion(String passcodeHash) {
        try {
            byte[] value = (passcodeHash == null ? "" : passcodeHash).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }

    public boolean isTokenValid(String token) {
        Claims claims = parseClaims(token);
        Date expiration = claims.getExpiration();
        return expiration == null || expiration.after(new Date());
    }

    public long extractTokenVersion(Claims claims) {

        Object value = claims.get("tokenVersion");

        if (value instanceof Number number) {
            return number.longValue();
        }

        return 0L;
    }

    public List<String> extractRoles(Claims claims) {
        Object roles = claims.get("roles");
        if (roles instanceof List<?>) {
            return ((List<?>) roles).stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .toList();
        }
        return List.of();
    }
}
