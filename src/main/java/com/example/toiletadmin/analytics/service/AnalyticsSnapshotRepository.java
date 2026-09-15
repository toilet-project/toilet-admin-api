package com.example.toiletadmin.analytics.service;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AnalyticsSnapshotRepository {

    private final JdbcTemplate jdbc;

    public AnalyticsSnapshotRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<StoredSnapshot> find(String reportKey, String propertyHash) {
        try {
            return jdbc.query("""
                    SELECT report_key, property_id_hash, range_start, range_end, payload_json,
                           fetched_at, expires_at, last_success_at, last_attempt_at,
                           last_error_code, failure_count, quota_json
                      FROM admin_analytics_snapshot
                     WHERE report_key=? AND property_id_hash=?
                    """, (rs, row) -> new StoredSnapshot(
                    rs.getString("report_key"),
                    rs.getString("property_id_hash"),
                    nullableDate(rs.getDate("range_start")),
                    nullableDate(rs.getDate("range_end")),
                    rs.getString("payload_json"),
                    rs.getTimestamp("fetched_at").toInstant(),
                    rs.getTimestamp("expires_at").toInstant(),
                    rs.getTimestamp("last_success_at").toInstant(),
                    rs.getTimestamp("last_attempt_at").toInstant(),
                    rs.getString("last_error_code"),
                    rs.getInt("failure_count"),
                    rs.getString("quota_json")
            ), reportKey, propertyHash).stream().findFirst();
        } catch (DataAccessException exception) {
            return Optional.empty();
        }
    }

    public void saveSuccess(
            String reportKey,
            String propertyHash,
            LocalDate rangeStart,
            LocalDate rangeEnd,
            String payload,
            Instant fetchedAt,
            Instant expiresAt,
            String quotaJson
    ) {
        jdbc.update("""
                INSERT INTO admin_analytics_snapshot(
                    report_key, property_id_hash, range_start, range_end, payload_json,
                    fetched_at, expires_at, last_success_at, last_attempt_at,
                    last_error_code, failure_count, quota_json
                ) VALUES(?,?,?,?,?,?,?,?,?,NULL,0,?)
                ON DUPLICATE KEY UPDATE
                    property_id_hash=VALUES(property_id_hash), range_start=VALUES(range_start), range_end=VALUES(range_end),
                    payload_json=VALUES(payload_json), fetched_at=VALUES(fetched_at), expires_at=VALUES(expires_at),
                    last_success_at=VALUES(last_success_at), last_attempt_at=VALUES(last_attempt_at),
                    last_error_code=NULL, failure_count=0, quota_json=VALUES(quota_json)
                """, reportKey, propertyHash, sqlDate(rangeStart), sqlDate(rangeEnd), payload,
                Timestamp.from(fetchedAt), Timestamp.from(expiresAt), Timestamp.from(fetchedAt), Timestamp.from(fetchedAt), quotaJson);
    }

    public void markFailure(String reportKey, String propertyHash, Instant attemptedAt, String errorCode) {
        try {
            jdbc.update("""
                    UPDATE admin_analytics_snapshot
                       SET last_attempt_at=?, last_error_code=?, failure_count=failure_count+1
                     WHERE report_key=? AND property_id_hash=?
                    """, Timestamp.from(attemptedAt), errorCode, reportKey, propertyHash);
        } catch (DataAccessException ignored) {
            // A missing migration must not prevent the administrator application from starting.
        }
    }

    public RepositoryStatus status(String propertyHash) {
        try {
            return jdbc.query("""
                    SELECT MAX(last_attempt_at) AS last_attempt_at,
                           MAX(last_success_at) AS last_success_at,
                           SUM(failure_count) AS failure_count
                      FROM admin_analytics_snapshot
                     WHERE property_id_hash=?
                    """, rs -> {
                if (!rs.next()) return RepositoryStatus.empty();
                Timestamp attempt = rs.getTimestamp("last_attempt_at");
                Timestamp success = rs.getTimestamp("last_success_at");
                return new RepositoryStatus(attempt == null ? null : attempt.toInstant(),
                        success == null ? null : success.toInstant(), rs.getLong("failure_count"));
            }, propertyHash);
        } catch (DataAccessException exception) {
            return RepositoryStatus.empty();
        }
    }

    private static Date sqlDate(LocalDate value) {
        return value == null ? null : Date.valueOf(value);
    }

    private static LocalDate nullableDate(Date value) {
        return value == null ? null : value.toLocalDate();
    }

    public record StoredSnapshot(
            String reportKey,
            String propertyHash,
            LocalDate rangeStart,
            LocalDate rangeEnd,
            String payloadJson,
            Instant fetchedAt,
            Instant expiresAt,
            Instant lastSuccessAt,
            Instant lastAttemptAt,
            String lastErrorCode,
            int failureCount,
            String quotaJson
    ) { }

    public record RepositoryStatus(Instant lastAttemptAt, Instant lastSuccessfulAt, long failureCount) {
        public static RepositoryStatus empty() {
            return new RepositoryStatus(null, null, 0);
        }
    }
}
