package com.example.smartrec.security;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Date;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import com.example.smartrec.entity.PublicShareLink;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.ShareLinkStatus;
import com.example.smartrec.repository.PublicShareLinkRepository;
import com.example.smartrec.repository.UserRepository;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

class GuestJwtSecurityTest {
    private static final String SECRET = "404E635266556A586E3272357538782F413F4428472B4B6250645367566B5970";
    private final JwtService jwt = new JwtService(SECRET);
    private final UserRepository users = mock(UserRepository.class);
    private final PublicShareLinkRepository links = mock(PublicShareLinkRepository.class);
    private final JwtAuthenticationFilter filter = new JwtAuthenticationFilter(jwt, users, links);
    private final String linkToken = "public-token";
    private final UUID linkId = UUID.randomUUID();
    private final UUID meetingId = UUID.randomUUID();

    @AfterEach void clearContext() { SecurityContextHolder.clearContext(); }

    private PublicShareLink activeLink() throws Exception {
        PublicShareLink link = new PublicShareLink();
        link.setId(linkId);
        link.setMeetingId(meetingId);
        link.setPasscodeHash("bcrypt-original");
        link.setStatus(ShareLinkStatus.ACTIVE);
        link.setTokenHash(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(linkToken.getBytes(StandardCharsets.UTF_8))));
        when(links.findById(linkId)).thenReturn(Optional.of(link));
        return link;
    }

    private String token(PublicShareLink link) {
        return jwt.generateGuestToken(linkId, meetingId, link.getPasscodeHash(),
                Date.from(Instant.now().plusSeconds(300)));
    }

    private int request(String path, String token, boolean expectedChain) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        request.setServletPath(path);
        if (token != null) request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean reached = new AtomicBoolean();
        filter.doFilter(request, response, (req, res) -> reached.set(true));
        assertEquals(expectedChain, reached.get());
        return response.getStatus();
    }

    @Test void validGuestCanReadOnlyItsShare() throws Exception {
        PublicShareLink link = activeLink();
        assertEquals(200, request("/public/share/" + linkToken, token(link), true));
        assertEquals("guest:" + linkId, SecurityContextHolder.getContext().getAuthentication().getName());
        assertEquals(List.of("ROLE_GUEST", "SCOPE_meeting:read"),
                SecurityContextHolder.getContext().getAuthentication().getAuthorities().stream()
                        .map(Object::toString).toList());
        verifyNoInteractions(users);
    }

    @Test void guestCannotUseAnotherLinkOrOwnerAndInternalApis() throws Exception {
        String guestToken = token(activeLink());
        assertEquals(401, request("/public/share/another-token", guestToken, false));
        for (String path : List.of("/meetings/" + meetingId, "/jobs/" + UUID.randomUUID(),
                "/folders", "/upload/status", "/internal/jobs/" + UUID.randomUUID() + "/ai-result")) {
            assertEquals(403, request(path, guestToken, false));
        }
        verifyNoInteractions(users);
    }

    @Test void wrongScopeExpiredAndBadSignatureAreRejected() throws Exception {
        PublicShareLink link = activeLink();
        String valid = token(link);
        var claims = jwt.parseClaims(valid);
        claims.put("scope", List.of("meeting:write"));
        String wrongScope = Jwts.builder().setClaims(claims)
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8))).compact();
        assertEquals(401, request("/public/share/" + linkToken, wrongScope, false));
        claims.put("scope", List.of("meeting:read"));
        claims.put("meetingId", UUID.randomUUID().toString());
        String wrongMeeting = Jwts.builder().setClaims(claims)
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8))).compact();
        assertEquals(401, request("/public/share/" + linkToken, wrongMeeting, false));
        assertEquals(401, request("/public/share/" + linkToken,
                jwt.generateGuestToken(linkId, meetingId, link.getPasscodeHash(),
                        Date.from(Instant.now().minusSeconds(1))), false));
        assertEquals(401, request("/public/share/" + linkToken, valid.substring(0, valid.length() - 2) + "xx", false));
    }

    @Test void revokedDeletedExpiredLinkAndChangedPasscodeInvalidateToken() throws Exception {
        PublicShareLink link = activeLink();
        String guestToken = token(link);
        link.setStatus(ShareLinkStatus.REVOKED);
        assertEquals(401, request("/public/share/" + linkToken, guestToken, false));
        link.setStatus(ShareLinkStatus.ACTIVE);
        link.setExpiresAt(Instant.now().minusSeconds(1));
        assertEquals(401, request("/public/share/" + linkToken, guestToken, false));
        link.setExpiresAt(null);
        link.setPasscodeHash("bcrypt-changed");
        assertEquals(401, request("/public/share/" + linkToken, guestToken, false));
        when(links.findById(linkId)).thenReturn(Optional.empty());
        assertEquals(401, request("/public/share/" + linkToken, guestToken, false));
    }

    @Test void publicShareWithoutAuthorizationStillReachesController() throws Exception {
        assertEquals(200, request("/public/share/" + linkToken, null, true));
        verifyNoInteractions(links, users);
    }

    @Test void existingUserAccessJwtStillAuthenticatesAsUser() throws Exception {
        User user = new User();
        user.setEmail("owner@example.com");
        when(users.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        String ownerToken = Jwts.builder().setSubject(user.getEmail())
                .claim("type", "access").claim("tokenVersion", user.getToken_version())
                .claim("roles", List.of("ROLE_USER"))
                .setIssuedAt(new Date()).setExpiration(Date.from(Instant.now().plusSeconds(300)))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8))).compact();

        assertEquals(200, request("/meetings/" + meetingId, ownerToken, true));
        assertEquals(user.getEmail(), SecurityContextHolder.getContext().getAuthentication().getName());
        verifyNoInteractions(links);
    }
}
