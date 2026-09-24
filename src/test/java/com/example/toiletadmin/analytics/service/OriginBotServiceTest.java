package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

class OriginBotServiceTest {
    @TempDir Path directory;
    private final Clock clock = Clock.fixed(Instant.parse("2026-09-24T03:00:00Z"),ZoneOffset.UTC);
    private final String fixture = """
      {"schema":1,"source":"origin-nginx","generatedAt":"2026-09-24T03:00:00Z",
       "startedAt":"2026-09-24T02:00:00Z","retentionDays":35,"coverageWarning":"","truncated":false,
       "progress":{"malformed":0,"backlog":false},"rawIp":"SHOULD_NOT_LEAK",
       "rows":[{"day":"2026-09-24","hour":"2026-09-24T02:00:00Z","bot":"Naver Yeti",
       "verification":"verified","path":"toilets_api","status":2,"count":23,
       "first":"2026-09-24T02:01:00Z","last":"2026-09-24T02:59:00Z","url":"SHOULD_NOT_LEAK"}]}
      """;
    private OriginBotService service(String data) throws Exception {
        Files.writeString(directory.resolve("origin-bots.json"),data);
        return new OriginBotService(directory.toString(),clock);
    }
    @Test void aggregatesAreSeparateAndUnknownFieldsCannotLeak() throws Exception {
        var report = service(fixture).report("today",null,null);
        assertThat(report.status()).isEqualTo("OK");
        assertThat(report.partial()).isTrue();
        assertThat(report.rows()).hasSize(1);
        assertThat(report.rows().getFirst().count()).isEqualTo(23);
        assertThat(report.toString()).doesNotContain("SHOULD_NOT_LEAK");
    }
    @Test void dateRangeAndUnconnectedAreNotMisrepresentedAsZero() throws Exception {
        assertThat(service(fixture).report("yesterday",null,null).rows()).isEmpty();
        assertThat(new OriginBotService("",clock).report("7d",null,null).status()).isEqualTo("DISABLED");
        assertThatThrownBy(() -> service(fixture).report("custom","2026-09-25","2026-09-25")).isInstanceOf(ResponseStatusException.class);
    }
    @Test void brokenOrUntrustedExportIsUnavailable() throws Exception {
        assertThat(service(fixture.replace("Naver Yeti","<script>bad</script>")).report("today",null,null).status()).isEqualTo("UNAVAILABLE");
        assertThat(service(fixture.replace("toilets_api","/private/member/123")).report("today",null,null).status()).isEqualTo("UNAVAILABLE");
        assertThat(service("{}").report("today",null,null).status()).isEqualTo("UNAVAILABLE");
    }
    @Test void oldCollectionIsExplicitlyStale() throws Exception {
        String old = fixture.replace("2026-09-24T03:00:00Z","2026-09-24T02:59:00Z");
        Files.writeString(directory.resolve("origin-bots.json"),old);
        var later = new OriginBotService(directory.toString(),Clock.fixed(Instant.parse("2026-09-24T04:00:00Z"),ZoneOffset.UTC));
        assertThat(later.report("today",null,null).status()).isEqualTo("STALE");
    }
}
