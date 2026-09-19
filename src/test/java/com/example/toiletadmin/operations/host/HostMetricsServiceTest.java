package com.example.toiletadmin.operations.host;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class HostMetricsServiceTest {
    @TempDir Path directory;
    final Clock clock = Clock.fixed(Instant.parse("2026-09-19T16:00:00Z"), ZoneOffset.UTC);
    HostMetricsService service() { return new HostMetricsService(directory.toString(), clock); }

    void write(Instant time) throws Exception {
        Files.writeString(directory.resolve("summary.json"), """
            {"schema":1,"generatedAt":"%s","samplePeriodSeconds":60,
             "latest":{"ts":%s,"cpuPercent":50,"boot":"private"},"assessment":{"level":"OK"},
             "days":[{"date":"2026-09-01"},{"date":"2026-09-20"}]}
            """.formatted(time, time.toEpochMilli()/1000.0));
    }

    @Test void freshDataUsesKoreanDateRangeAndRemovesPrivateIdentifiers() throws Exception {
        write(clock.instant()); var result=service().summary(7);
        assertEquals("OK",result.path("status").asText());
        assertEquals("2026-09-20",result.path("days").get(0).path("date").asText());
        assertEquals(1,result.path("days").size());
        assertFalse(result.path("latest").has("boot"));
    }
    @Test void staleOrFutureDataNeverLooksHealthy() throws Exception {
        for(var time:new Instant[]{clock.instant().minusSeconds(181),clock.instant().plusSeconds(61)}) {
            write(time);assertEquals("STALE",service().summary(7).path("status").asText());
        }
    }
    @Test void disabledMissingMalformedOversizeAndUnsupportedDataAreExplicit() throws Exception {
        assertEquals("DISABLED",new HostMetricsService("",clock).summary(7).path("status").asText());
        assertEquals("UNAVAILABLE",service().summary(7).path("status").asText());
        for(var data:new String[]{"invalid json", "x".repeat(2_000_001),"{\"schema\":2}"}) {
            Files.writeString(directory.resolve("summary.json"),data);
            assertEquals("UNAVAILABLE",service().summary(7).path("status").asText());
        }
    }
    @Test void historyRangeCannotEscapeDirectoryOrReadFutureData() throws Exception {
        assertThrows(IllegalArgumentException.class,()->service().summary(100000));
        assertThrows(IllegalArgumentException.class,()->service().history(LocalDate.of(2026,9,21)));
        assertThrows(IllegalArgumentException.class,()->service().history(LocalDate.of(2026,8,21)));
        assertEquals("UNAVAILABLE",service().history(LocalDate.of(2026,9,19)).path("status").asText());
        Files.writeString(directory.resolve("2026-09-19.json"),"{\"schema\":1,\"date\":\"2026-09-19\",\"samples\":[]}");
        assertEquals("OK",service().history(LocalDate.of(2026,9,19)).path("status").asText());
    }
}
