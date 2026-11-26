package com.zynckle.api.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import com.zynckle.api.security.AuthFilter;
import com.zynckle.api.security.AuthService;
import com.zynckle.api.security.SessionCookies;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import java.util.List;

@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AuthService authService) throws Exception {
        // Spring's CSRF tokens are off: AuthFilter instead requires the X-Zynckle-Request header on
        // cookie-authenticated writes, and CORS (below) only lets the app's own origins send it.
        // AuthFilter rejects unauthenticated /api calls; Spring's own authorisation stays open.
        return http.csrf(csrf -> csrf.disable())
            .addFilterBefore(new AuthFilter(authService), AnonymousAuthenticationFilter.class)
            .httpBasic(basic -> basic.disable())
            .formLogin(form -> form.disable())
            .cors(Customizer.withDefaults())
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/**", "/actuator/**").permitAll()
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .anyRequest().permitAll())
            .build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(SessionCookies cookies) {
        CorsConfiguration config = new CorsConfiguration();
        // Credentialed cross-origin requests only from the app's own origins (never "*").
        config.setAllowedOrigins(cookies.allowedOrigins());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
