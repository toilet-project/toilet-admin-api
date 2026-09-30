package com.example.toiletadmin.cloudflare.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record CloudflareMonitoringResponse(String status, Instant checkedAt, Instant start, Instant end,
        Map<String, Section<?>> sections) {
    public record Section<T>(String status, String message, T data) { }
    public record R2Hour(Instant at, double classA, double classB, double puts, double getOk, double getMissing, double serverErrors) { }
    public record R2Health(List<R2Hour> hours, double puts24h, double previousPuts24h,
            double lastHourPuts, double previousHourPuts, double getOk, double getMissing, double serverErrors) { }
    public record CacheWrite(String id, String label, String prefix, Double requests, Double successful) { }
    public record CacheWrites(String bucket, double total, List<CacheWrite> categories) { }
    public record WorkerHealth(String name, double requests, double errors, double cpuMs, Double cpuP95Ms, Double responseP95Ms) { }
    public record DatabaseHealth(String id, double queries, double rowsRead, double rowsWritten, Double queryP95Ms) { }
    public record StorageGrowth(String id, double bytes, Instant observedAt, Double previousBytes, Instant previousAt) { }
    public record TrafficHealth(String domain, double requests, double cdnHits, double edgeErrors,
            double originErrors, double verifiedBots, Map<String, Double> cacheStatuses, Map<String, Double> botCategories) { }
    public record ObjectHealth(double requests, double errors, double cpuErrors, double memoryErrors, double internalErrors) { }
    public record RefreshRun(String status, String conclusion, Instant startedAt, Instant updatedAt, String url) { }
    public record RefreshHealth(Instant lastSuccessAt, List<RefreshRun> runs) { }
}
