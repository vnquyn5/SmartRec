package com.example.smartrec.security;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.filter.OncePerRequestFilter;

import com.example.smartrec.entity.User;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.repository.PublicShareLinkRepository;
import com.example.smartrec.enums.ShareLinkStatus;
import java.util.UUID;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final UserRepository userRepository;
    private final PublicShareLinkRepository shareLinkRepository; // Đọc trạng thái link mới nhất để thu hồi JWT ngay.

    // Constructor Spring dùng trong runtime, có đủ repository để kiểm tra Guest token.
    @Autowired
    public JwtAuthenticationFilter(JwtService jwtService, UserRepository userRepository,
            PublicShareLinkRepository shareLinkRepository) {
        this.jwtService = jwtService; // Dùng chung parser/chữ ký với Owner JWT.
        this.userRepository=userRepository; // Giữ nguyên đường xác thực Owner hiện hữu.
        this.shareLinkRepository = shareLinkRepository; // Cần truy vấn link khi nhận Guest JWT.
    }

    // Constructor tương thích với test/config cũ chỉ truyền hai dependency Owner.
    public JwtAuthenticationFilter(JwtService jwtService, UserRepository userRepository) {
        this(jwtService, userRepository, null); // Test Owner không chạy nhánh Guest nên không cần repository này.
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String authorizationHeader = request.getHeader(HttpHeaders.AUTHORIZATION); // Đọc Bearer token từ request.

        if (authorizationHeader == null || !authorizationHeader.startsWith(BEARER_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        String token = authorizationHeader.substring(BEARER_PREFIX.length()); // Bỏ tiền tố để còn chuỗi JWT.
        try {
            if (SecurityContextHolder.getContext().getAuthentication() == null
                    && jwtService.isTokenValid(token)) {
                Claims claims = jwtService.parseClaims(token); // Chữ ký và cấu trúc JWT đã được kiểm tra.
                if ("GUEST".equals(claims.get("type", String.class))) {
                    // Không cho Guest dùng JWT này ở API Owner hoặc API nội bộ.
                    if (!request.getServletPath().startsWith("/public/share/")) {
                        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                        return;
                    }
                    UUID shareLinkId = UUID.fromString(claims.get("shareLinkId", String.class)); // Đọc link ID đã ký trong token.
                    UUID meetingId = UUID.fromString(claims.get("meetingId", String.class)); // Đọc meeting ID đã ký trong token.
                    var link = shareLinkRepository.findById(shareLinkId).orElseThrow(); // Tải trạng thái link hiện tại.
                    // Link bị revoke, đổi meeting hoặc hết hạn sẽ làm JWT mất hiệu lực ngay.
                    if (link.getStatus() != ShareLinkStatus.ACTIVE
                            || !link.getMeetingId().equals(meetingId)
                            || (link.getExpiresAt() != null && !link.getExpiresAt().isAfter(java.time.Instant.now()))) {
                        throw new IllegalArgumentException("Guest share link is unavailable");
                    }
                    var authentication = new UsernamePasswordAuthenticationToken(
                            claims.getSubject(), null, // Principal Guest riêng, không tra cứu thành User.
                            java.util.List.of(new SimpleGrantedAuthority("ROLE_GUEST"),
                                    new SimpleGrantedAuthority("SCOPE_meeting:read"))); // Authority chỉ đọc.
                    authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request)); // Gắn thông tin HTTP cho Security context.
                    SecurityContextHolder.getContext().setAuthentication(authentication); // Đánh dấu request là Guest đã xác thực.
                    filterChain.doFilter(request, response); // Tiếp tục xử lý public-share controller.
                    return; // Không chạy tiếp nhánh Owner bên dưới.
                }
                String email = claims.getSubject();

                User user = userRepository.findByEmail(email)
                        .orElseThrow(() ->
                                new RuntimeException("User not found"));

                long tokenVersion =
                        jwtService.extractTokenVersion(claims);

                if (tokenVersion != user.getToken_version()) {

                    SecurityContextHolder.clearContext();

                    filterChain.doFilter(request, response);
                    return;
                }
                var authorities = jwtService.extractRoles(claims).stream()
                        .map(SimpleGrantedAuthority::new)
                        .toList();
                var authentication = new UsernamePasswordAuthenticationToken(
                        claims.getSubject(),
                        null,
                        authorities);
                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        } catch (RuntimeException ex) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        filterChain.doFilter(request, response);
    }
}
