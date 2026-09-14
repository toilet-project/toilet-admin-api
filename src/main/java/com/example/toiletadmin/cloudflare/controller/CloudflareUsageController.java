package com.example.toiletadmin.cloudflare.controller;

import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse;
import com.example.toiletadmin.cloudflare.service.CloudflareUsageService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/admin/v1/cloudflare")
public class CloudflareUsageController {

    private final CloudflareUsageService cloudflareUsageService;

    @GetMapping("/usage")
    public CloudflareUsageResponse usage() {
        return cloudflareUsageService.getUsage();
    }
}
