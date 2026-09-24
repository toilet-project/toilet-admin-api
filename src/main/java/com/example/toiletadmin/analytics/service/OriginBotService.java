package com.example.toiletadmin.analytics.service;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Reads an allowlisted, read-only export. Never reads access logs or queries Cloudflare. */
@Service
public class OriginBotService {
    private static final Set<String> BOTS = Set.of("Googlebot", "Naver Yeti", "Bingbot", "Naver Ads-Naver",
            "Naver Blueno", "Claude-SearchBot", "ClaudeBot", "Claude-User", "GPTBot", "OAI-SearchBot",
            "ChatGPT-User", "Meta-ExternalAgent", "Facebook Preview", "Other bot");
    private static final Set<String> PATHS = Set.of("home", "toilet_detail", "regions", "sitemap", "robots",
            "toilets_api", "analytics_api", "auth_api", "admin", "assets", "other");
    private static final Set<String> VERIFICATION = Set.of("verified", "declared", "unmatched");
    private final String directory;
    private final Clock clock;
    private final JsonMapper mapper = JsonMapper.builder().build();

    @Autowired
    public OriginBotService(@Value("${operations.origin-bots-directory:}") String directory) {
        this(directory, Clock.systemUTC());
    }
    OriginBotService(String directory, Clock clock) { this.directory = directory; this.clock = clock; }

    public record Row(String day, String hour, String bot, String verification, String path, int status,
                      long count, String first, String last) {}
    public record Report(String status, String message, String from, String to, String generatedAt,
                         String startedAt, boolean partial, List<Row> rows) {}

    public Report report(String range, String from, String to) {
        var query = AnalyticsExploreQuery.resolve(range, from, to, Map.of(), clock);
        if (directory.isBlank()) return empty("DISABLED", "미니 PC 봇 접근 수집기가 아직 연결되지 않았습니다. 0건을 뜻하지 않습니다.", query);
        try {
            JsonNode data = loadExport();
            if (data.path("schema").asInt() != 1 || !data.path("source").asText().equals("origin-nginx")
                    || data.path("retentionDays").asInt() != 35 || !data.path("rows").isArray()
                    || data.path("rows").size() > 50000) throw new IllegalArgumentException();
            Instant generated = Instant.parse(data.path("generatedAt").asText());
            Instant started = Instant.parse(data.path("startedAt").asText());
            long age = Duration.between(generated, clock.instant()).getSeconds();
            boolean partial = data.path("truncated").asBoolean() || data.path("progress").path("backlog").asBoolean()
                    || data.path("progress").path("malformed").asLong() > 0
                    || !data.path("coverageWarning").asText().isEmpty() || started.isAfter(query.start())
                    || query.from().isBefore(LocalDate.now(clock.withZone(AnalyticsExploreQuery.SEOUL)).minusDays(34));
            var rows = new java.util.ArrayList<Row>();
            for (JsonNode row : data.path("rows")) {
                // Construct a DTO: unexpected fields, including IP/UA/URL, can never leak through.
                String bot = row.path("bot").asText(), verification = row.path("verification").asText(), path = row.path("path").asText();
                LocalDate day = LocalDate.parse(row.path("day").asText());
                Instant hour = Instant.parse(row.path("hour").asText());
                Instant first = Instant.parse(row.path("first").asText()), last = Instant.parse(row.path("last").asText());
                int status = row.path("status").asInt(); long count = row.path("count").asLong();
                if (!BOTS.contains(bot) || !VERIFICATION.contains(verification) || !PATHS.contains(path)
                        || status < 1 || status > 5 || count < 1 || count > 1_000_000_000L
                        || first.isAfter(last) || first.isBefore(hour) || !last.isBefore(hour.plusSeconds(3600))
                        || !day.equals(hour.atZone(AnalyticsExploreQuery.SEOUL).toLocalDate())
                        || last.isAfter(generated.plusSeconds(60))) throw new IllegalArgumentException();
                if (day.isBefore(query.from()) || day.isAfter(query.to())) continue;
                rows.add(new Row(day.toString(), hour.toString(), bot, verification, path, status, count, first.toString(), last.toString()));
            }
            boolean stale = age < -60 || age > 180;
            return new Report(stale ? "STALE" : "OK", stale ? "최근 수집이 지연됐습니다. 마지막 수집 기록을 표시합니다."
                    : "미니 PC Nginx에 도착한 요청만 집계합니다. 방문자 수·페이지뷰와 다른 지표입니다.",
                    query.from().toString(), query.to().toString(), generated.toString(), started.toString(), partial, List.copyOf(rows));
        } catch (Exception ignored) {
            return empty("UNAVAILABLE", "봇 접근 기록을 읽지 못했습니다. 기록 없음이나 봇 0건으로 해석하지 마세요.", query);
        }
    }
    protected JsonNode loadExport() throws Exception {
        Path file = Path.of(directory).resolve("origin-bots.json");
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IllegalArgumentException();
        try (var input = Files.newInputStream(file)) {
            byte[] bytes = input.readNBytes(12_000_001);
            if (bytes.length > 12_000_000) throw new IllegalArgumentException();
            return mapper.readTree(bytes);
        }
    }
    private Report empty(String status, String message, AnalyticsExploreQuery q) {
        return new Report(status, message, q.from().toString(), q.to().toString(), null, null, true, List.of());
    }
}
