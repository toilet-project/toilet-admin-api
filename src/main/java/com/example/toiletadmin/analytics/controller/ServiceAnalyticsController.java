package com.example.toiletadmin.analytics.controller;

import com.example.toiletadmin.analytics.dto.ServiceAnalyticsRealtimeResponse;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsStatusResponse;
import com.example.toiletadmin.analytics.service.AnalyticsDateRange;
import com.example.toiletadmin.analytics.service.ServiceAnalyticsService;
import com.example.toiletadmin.analytics.service.AnalyticsExploreService;
import com.example.toiletadmin.analytics.service.OriginBotService;
import com.example.toiletadmin.analytics.dto.AnalyticsExploreResponse;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
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
    private final AnalyticsExploreService explorer;
    private final OriginBotService originBots;

    @GetMapping("/origin-bots")
    public ResponseEntity<OriginBotService.Report> originBots(
            @RequestParam(defaultValue="7d") String range,
            @RequestParam(required=false) String from,
            @RequestParam(required=false) String to) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(originBots.report(range, from, to));
    }

    @GetMapping("/explore")
    public ResponseEntity<AnalyticsExploreResponse> explore(
            @RequestParam(defaultValue="7d") String range,
            @RequestParam(required=false) String from,
            @RequestParam(required=false) String to,
            @RequestParam(required=false) String source,
            @RequestParam(required=false) String channel,
            @RequestParam(required=false) String device,
            @RequestParam(required=false) String page,
            @RequestParam(required=false) String country,
            @RequestParam(defaultValue="true") boolean excludeBots) {
        Map<String,String> filters=new LinkedHashMap<>();
        filters.put("source",source); filters.put("channel",channel); filters.put("device",device);
        filters.put("page",page); filters.put("country",country);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(explorer.explore(range,from,to,filters,excludeBots));
    }

    @GetMapping("/overview")
    public ServiceAnalyticsReportResponse overview() {
        return service.overview();
    }

    @GetMapping("/realtime")
    public ServiceAnalyticsRealtimeResponse realtime(@RequestParam(defaultValue="true") boolean excludeBots) {
        return service.realtime(excludeBots);
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
