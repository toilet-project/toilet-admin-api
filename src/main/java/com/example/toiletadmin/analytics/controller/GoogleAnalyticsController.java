package com.example.toiletadmin.analytics.controller;

import com.example.toiletadmin.analytics.dto.GoogleAnalyticsRealtimeResponse;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsStatusResponse;
import com.example.toiletadmin.analytics.service.AnalyticsDateRange;
import com.example.toiletadmin.analytics.service.GoogleAnalyticsService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/admin/v1/google-analytics")
public class GoogleAnalyticsController {

    private final GoogleAnalyticsService service;

    @GetMapping("/overview")
    public GoogleAnalyticsReportResponse overview() {
        return service.overview();
    }

    @GetMapping("/realtime")
    public GoogleAnalyticsRealtimeResponse realtime() {
        return service.realtime(false);
    }

    @GetMapping({"/trend", "/content", "/acquisition", "/audience", "/events"})
    public GoogleAnalyticsReportResponse report(
            @RequestParam(defaultValue = "7d") String range,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to
    ) {
        return service.report(AnalyticsDateRange.resolve(range, from, to), false);
    }

    @GetMapping("/collection-status")
    public GoogleAnalyticsStatusResponse status() {
        return service.status();
    }

    @PostMapping("/refresh")
    public GoogleAnalyticsReportResponse refresh(
            @RequestParam(defaultValue = "7d") String range,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to
    ) {
        return service.refresh(AnalyticsDateRange.resolve(range, from, to));
    }
}
