package com.example.toiletadmin.analytics.controller;

import com.example.toiletadmin.analytics.dto.ServiceAnalyticsRealtimeResponse;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsStatusResponse;
import com.example.toiletadmin.analytics.service.AnalyticsDateRange;
import com.example.toiletadmin.analytics.service.ServiceAnalyticsService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/admin/v1/service-analytics")
public class ServiceAnalyticsController {

    private final ServiceAnalyticsService service;

    @GetMapping("/overview")
    public ServiceAnalyticsReportResponse overview() {
        return service.overview();
    }

    @GetMapping("/realtime")
    public ServiceAnalyticsRealtimeResponse realtime() {
        return service.realtime();
    }

    @GetMapping({"/trend", "/content", "/acquisition", "/audience", "/events", "/refresh"})
    public ServiceAnalyticsReportResponse report(
            @RequestParam(defaultValue = "7d") String range,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to
    ) {
        return service.report(AnalyticsDateRange.resolve(range, from, to));
    }

    @GetMapping("/collection-status")
    public ServiceAnalyticsStatusResponse status() {
        return service.status();
    }
}
