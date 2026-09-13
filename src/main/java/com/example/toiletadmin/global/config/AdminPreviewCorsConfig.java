package com.example.toiletadmin.global.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Allows the authenticated HTTPS preview to read the admin application's operational endpoints. */
@Configuration
public class AdminPreviewCorsConfig implements WebMvcConfigurer {

    public static final String PREVIEW_ORIGIN = "https://preview.geupddong.com";

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/admin/**")
                .allowedOrigins(PREVIEW_ORIGIN)
                .allowCredentials(true)
                .allowedMethods("GET", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }
}
