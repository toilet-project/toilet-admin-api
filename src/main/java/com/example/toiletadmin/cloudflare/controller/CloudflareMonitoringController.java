package com.example.toiletadmin.cloudflare.controller;

import com.example.toiletadmin.cloudflare.dto.CloudflareMonitoringResponse;
import com.example.toiletadmin.cloudflare.service.CloudflareMonitoringService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class CloudflareMonitoringController {
    private final CloudflareMonitoringService service;
    @GetMapping("/api/admin/v1/cloudflare/monitoring")
    public ResponseEntity<CloudflareMonitoringResponse> monitoring() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.getMonitoring());
    }
    @GetMapping("/api/admin/v1/cloudflare/monitoring/{section}")
    public ResponseEntity<CloudflareMonitoringResponse> section(@PathVariable String section) {
        try {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.getSection(section));
        } catch (IllegalArgumentException ignored) {
            return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).build();
        }
    }
}
