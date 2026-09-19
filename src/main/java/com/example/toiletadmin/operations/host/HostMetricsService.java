package com.example.toiletadmin.operations.host;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
public class HostMetricsService {
    private static final int MAX_BYTES = 2_000_000;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private final String directory;
    private final Clock clock;
    private final JsonMapper mapper = JsonMapper.builder().build();

    @Autowired
    public HostMetricsService(@Value("${operations.host-metrics-directory:}") String directory) {
        this(directory, Clock.systemUTC());
    }

    HostMetricsService(String directory, Clock clock) {
        this.directory = directory;
        this.clock = clock;
    }

    public ObjectNode summary(int days) {
        if (!Set.of(7, 30, 90, 365).contains(days)) throw new IllegalArgumentException("Invalid range");
        if (directory.isBlank()) return state("DISABLED", "미니 PC 수집기 연결을 기다리고 있습니다.");
        try {
            JsonNode data = load("summary.json");
            Instant at = Instant.parse(data.path("generatedAt").asText());
            long age = Duration.between(at, clock.instant()).getSeconds();
            if (!data.path("latest").isObject() || !data.path("days").isArray()
                    || data.path("days").size() > 365 || data.path("samplePeriodSeconds").asInt() != 60
                    || Math.abs(data.path("latest").path("ts").asDouble() - at.toEpochMilli() / 1000.0) > 2) {
                throw new IllegalArgumentException("Invalid summary");
            }
            ObjectNode result = state(age < -60 || age > 180 ? "STALE" : "OK",
                    age < -60 || age > 180 ? "최근 수집이 지연됐습니다. 마지막 값은 현재 상태를 보장하지 않습니다." : "미니 PC 전체를 1분마다 기록합니다.");
            for (String key : new String[]{"generatedAt", "samplePeriodSeconds", "sampleRetentionDays", "dailyRetentionDays", "latest", "assessment"}) {
                result.set(key, data.path(key));
            }
            var filtered = result.putArray("days");
            LocalDate cutoff = LocalDate.now(clock.withZone(KST)).minusDays(days - 1L);
            for (JsonNode day : data.path("days")) {
                LocalDate date = LocalDate.parse(day.path("date").asText());
                if (!date.isBefore(cutoff)) filtered.add(day);
            }
            // Remove implementation identifiers even if a future collector accidentally exports them.
            ((ObjectNode) result.path("latest")).remove(Set.of("raw", "boot", "monotonic", "counters", "ifindex"));
            return result;
        } catch (Exception ignored) {
            return state("UNAVAILABLE", "수집 기록을 읽지 못했습니다. 수집기와 읽기 전용 연결을 확인하세요.");
        }
    }

    public ObjectNode history(LocalDate date) {
        LocalDate today = LocalDate.now(clock.withZone(KST));
        if (date.isAfter(today) || date.isBefore(today.minusDays(29))) throw new IllegalArgumentException("History is available for 30 days");
        if (directory.isBlank()) return state("DISABLED", "미니 PC 수집기 연결을 기다리고 있습니다.");
        try {
            JsonNode data = load(date + ".json");
            if (!date.toString().equals(data.path("date").asText()) || !data.path("samples").isArray()
                    || data.path("samples").size() > 2000) throw new IllegalArgumentException("Invalid history");
            ObjectNode result = state("OK", "선택한 날의 분 단위 기록입니다. 빈 구간은 측정되지 않은 시간입니다.");
            result.put("date", date.toString());
            result.set("samples", data.path("samples"));
            return result;
        } catch (Exception ignored) {
            return state("UNAVAILABLE", "선택한 날짜에 보관된 분 단위 기록이 없습니다.");
        }
    }

    private JsonNode load(String filename) throws Exception {
        Path path = Path.of(directory).resolve(filename);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw new IllegalArgumentException("Missing record");
        try (var input = Files.newInputStream(path)) {
            byte[] bytes = input.readNBytes(MAX_BYTES + 1);
            if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("Record too large");
            JsonNode data = mapper.readTree(bytes);
            if (data.path("schema").asInt() != 1) throw new IllegalArgumentException("Unknown schema");
            return data;
        }
    }

    private ObjectNode state(String status, String message) {
        return mapper.createObjectNode().put("status", status).put("message", message);
    }
}
