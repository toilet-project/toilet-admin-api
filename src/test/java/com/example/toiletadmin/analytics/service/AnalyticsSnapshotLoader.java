package com.example.toiletadmin.analytics.service;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Test-runtime import only. Import statements never run against the operational database. */
final class AnalyticsSnapshotLoader {
    static Clock load(JdbcTemplate jdbc, Path path) throws IOException {
        if (Files.size(path) > 64L * 1024 * 1024) throw new IOException("Snapshot exceeds size limit");
        var mapper = JsonMapper.builder().build();
        var events = new ArrayList<Object[]>();
        var summaries = new ArrayList<Object[]>();
        var dimensions = new ArrayList<Object[]>();
        Instant captured = null;
        try (var lines = Files.newBufferedReader(path)) {
            for (String line; (line = lines.readLine()) != null;) {
                var row = mapper.readTree(line);
                switch (row.path("kind").asText()) {
                    case "meta" -> {
                        if (captured != null || !row.path("mode").asText().equals("production-snapshot")) throw new IOException("Invalid snapshot metadata");
                        captured = Instant.parse(row.path("capturedAt").asText());
                    }
                    case "event" -> events.add(new Object[]{
                        row.path("id").asLong(), timestamp(row, "at"), java.sql.Date.valueOf(row.path("date").asText()),
                        text(row,"name"), text(row,"page"), text(row,"channel"), text(row,"source"), text(row,"device"),
                        text(row,"os"), text(row,"browser"), text(row,"country"), text(row,"city"),
                        alias(row.path("v").asLong()), alias(row.path("s").asLong()), row.path("seconds").asInt(),
                        text(row,"bucket"), text(row,"detail"), row.path("success").isNull()?null:row.path("success").asInt()==1,
                        row.path("key").asInt()==1, traffic(row)
                    });
                    case "summary" -> summaries.add(new Object[]{ java.sql.Date.valueOf(text(row,"date")),
                        row.path("users").asLong(), row.path("new").asLong(), row.path("sessions").asLong(), row.path("views").asLong(),
                        row.path("engaged").asLong(), row.path("key").asLong(), row.path("seconds").asLong(), timestamp(row,"calculated") });
                    case "dimension" -> dimensions.add(new Object[]{ java.sql.Date.valueOf(text(row,"date")), text(row,"type"),
                        text(row,"dimension"), text(row,"label"), row.path("users").asLong(), row.path("views").asLong(),
                        row.path("sessions").asLong(), row.path("events").asLong(), row.path("key").asLong(), row.path("seconds").asLong() });
                    default -> throw new IOException("Unknown snapshot record");
                }
                if (events.size()>100000 || summaries.size()>93 || dimensions.size()>100000) throw new IOException("Snapshot record limit exceeded");
            }
        }
        if (captured == null || captured.isAfter(Instant.now().plusSeconds(60))) throw new IOException("Snapshot timestamp invalid");
        jdbc.batchUpdate("INSERT INTO service_analytics_event(event_id,occurred_at,occurred_date,event_name,page_key,channel_key,source_key,device_type,os_family,browser_family,country_code,city_name,visitor_hash,session_hash,engagement_seconds,result_count_bucket,event_detail,success_status,key_event,traffic_class) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", events);
        jdbc.batchUpdate("INSERT INTO service_analytics_daily_summary VALUES(?,?,?,?,?,?,?,?,?)", summaries);
        jdbc.batchUpdate("INSERT INTO service_analytics_daily_dimension VALUES(?,?,?,?,?,?,?,?,?,?)", dimensions);
        return Clock.fixed(captured, ZoneOffset.UTC);
    }
    private static String text(JsonNode row, String field) { return row.path(field).isNull()?"":row.path(field).asText(); }
    private static String traffic(JsonNode row) throws IOException {
        String value=row.has("traffic")?row.path("traffic").asText():"LEGACY";
        if(!java.util.Set.of("LEGACY","UNFLAGGED","BOT").contains(value))throw new IOException("Invalid traffic class");
        return value;
    }
    private static Timestamp timestamp(JsonNode row, String field) { return row.path(field).isNull()?null:Timestamp.from(Instant.parse(row.path(field).asText())); }
    private static byte[] alias(long value) {
        if (value <= 0 || value > 100000) throw new IllegalArgumentException("Invalid temporary alias");
        return ByteBuffer.allocate(32).putLong(value).array();
    }
}
