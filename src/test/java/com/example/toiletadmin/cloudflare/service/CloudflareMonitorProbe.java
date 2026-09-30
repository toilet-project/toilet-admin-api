package com.example.toiletadmin.cloudflare.service;

import java.nio.file.Files;
import java.nio.file.Path;
import tools.jackson.databind.ObjectMapper;

/** Explicit local read-only smoke check. Not included in the production artifact. */
public class CloudflareMonitorProbe {
    public static void main(String[] args) throws Exception {
        String token = System.getenv("CF_MONITOR_PROBE_TOKEN");
        String account = System.getenv("CF_MONITOR_PROBE_ACCOUNT");
        if (args.length != 1 || token == null || account == null) throw new IllegalArgumentException("Probe configuration missing");
        var client = new CloudflareAnalyticsClient("https://api.cloudflare.com/client/v4/graphql", account, token);
        var service = new CloudflareUsageService(client, true, 300, "Workers Paid", 29,
                10_000_000, 25_000_000_000L, 10_000_000_000L, "https://dash.cloudflare.com/");
        var result = service.getUsage();
        Files.writeString(Path.of(args[0]), new ObjectMapper().writeValueAsString(result));
        var monitoring = new CloudflareMonitoringService(client, true, 300, "geupddong.com", "geupddong-next-production-cache").getMonitoring();
        Files.writeString(Path.of(args[0]).resolveSibling("admin-monitor-preview.json"), new ObjectMapper().writeValueAsString(monitoring));
        System.out.println("Monitoring: " + monitoring.status() + ", " + monitoring.sections().entrySet().stream()
                .map(e -> e.getKey() + ":" + e.getValue().status()).toList());
        System.out.println("Read-only probe: " + result.status() + ", " + result.metrics().size() + " metrics, "
                + result.resources().size() + " resources. No credentials in output.");
    }
}
