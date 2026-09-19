package com.example.smartrec.service.impl;

import com.example.smartrec.entity.User;
import com.example.smartrec.service.JwtService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.function.Function;

@Service
public class JwtServiceImpl implements JwtService {

    private final SecretKey secretKey;
    private final long expiration;

    public JwtServiceImpl(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.expiration}") long expiration) {
        this.secretKey = Keys.hmacShaKeyFor(
                secret.getBytes(StandardCharsets.UTF_8));

        this.expiration = expiration;
    }

    @Override
    public String generateToken(User user) {

        Date now = new Date();

        Date expirationDate = new Date(
                now.getTime() + expiration);

        String subject = user.getEmail() != null ? user.getEmail() : user.getPhone();

        return Jwts.builder()
                .setSubject(subject)
                .claim("userId", user.getId().toString())
                .claim("fullName", user.getFull_name())
                .setIssuedAt(now)
                .setExpiration(expirationDate)
                .signWith(secretKey)
                .compact();
    }

    @Override
    public String extractEmail(String token) {

        return extractClaim(
                token,
                Claims::getSubject);
    }

    @Override
    public boolean isTokenValid(String token, User user) {

        String email = extractEmail(token);

        return email.equals(user.getEmail())
                && !isTokenExpired(token);
    }

    private boolean isTokenExpired(String token) {

        Date expirationDate = extractClaim(
                token,
                Claims::getExpiration);

        return expirationDate.before(new Date());
    }

    private <T> T extractClaim(
            String token,
            Function<Claims, T> claimsResolver) {

        Claims claims = Jwts.parserBuilder()
                .setSigningKey(secretKey)
                .build()
                .parseClaimsJws(token)
                .getBody();

        return claimsResolver.apply(claims);
    }

}
