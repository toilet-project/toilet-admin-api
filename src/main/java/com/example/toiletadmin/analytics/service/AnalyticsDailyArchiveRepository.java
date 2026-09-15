package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.service.DailyAnalyticsArchive.DailyBreakdown;
import com.example.toiletadmin.analytics.service.DailyAnalyticsArchive.DailySummary;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.OptionalLong;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class AnalyticsDailyArchiveRepository {

    private static final int BATCH_SIZE = 500;
    private final JdbcTemplate jdbc;

    public AnalyticsDailyArchiveRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean tablesAvailable() {
        try {
            jdbc.queryForObject("SELECT COUNT(*) FROM admin_analytics_daily_summary WHERE 1=0", Long.class);
            jdbc.queryForObject("SELECT COUNT(*) FROM admin_analytics_daily_breakdown WHERE 1=0", Long.class);
            jdbc.queryForObject("SELECT COUNT(*) FROM admin_analytics_collection_run WHERE 1=0", Long.class);
            return true;
        } catch (DataAccessException exception) {
            return false;
        }
    }

    public boolean alreadySucceeded(String propertyHash, LocalDate targetDate) {
        try {
            Long count = jdbc.queryForObject("""
                    SELECT COUNT(*)
                      FROM admin_analytics_collection_run
                     WHERE property_id_hash=? AND target_date=? AND status='SUCCESS'
                    """, Long.class, propertyHash, Date.valueOf(targetDate));
            return count != null && count > 0;
        } catch (DataAccessException exception) {
            return false;
        }
    }

    public OptionalLong startRun(
            String propertyHash,
            LocalDate targetDate,
            LocalDate rangeStart,
            LocalDate rangeEnd,
            Instant startedAt,
            int retryCount
    ) {
        try {
            var keyHolder = new GeneratedKeyHolder();
            PreparedStatementCreator creator = connection -> {
                PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO admin_analytics_collection_run(
                            property_id_hash, target_date, range_start, range_end, run_type,
                            status, started_at, retry_count
                        ) VALUES(?,?,?,?,?,'RUNNING',?,?)
                        """, Statement.RETURN_GENERATED_KEYS);
                statement.setString(1, propertyHash);
                statement.setDate(2, Date.valueOf(targetDate));
                statement.setDate(3, Date.valueOf(rangeStart));
                statement.setDate(4, Date.valueOf(rangeEnd));
                statement.setString(5, retryCount == 0 ? "DAILY" : "RETRY");
                statement.setTimestamp(6, Timestamp.from(startedAt));
                statement.setInt(7, retryCount);
                return statement;
            };
            jdbc.update(creator, keyHolder);
            Number key = keyHolder.getKeyList().stream()
                    .flatMap(values -> values.values().stream())
                    .filter(Number.class::isInstance)
                    .map(Number.class::cast)
                    .findFirst()
                    .orElse(null);
            return key == null ? OptionalLong.empty() : OptionalLong.of(key.longValue());
        } catch (DataAccessException exception) {
            return OptionalLong.empty();
        }
    }

    @Transactional
    public int replaceRange(
            String propertyHash,
            String reportTimezone,
            LocalDate rangeStart,
            LocalDate rangeEnd,
            DailyAnalyticsArchive archive,
            Instant collectedAt
    ) {
        List<DailySummary> summaries = archive.summaries().stream()
                .filter(value -> !value.reportDate().isBefore(rangeStart) && !value.reportDate().isAfter(rangeEnd))
                .toList();
        if (summaries.size() != rangeStart.datesUntil(rangeEnd.plusDays(1)).count()) {
            throw new IllegalStateException("Google Analytics archive is missing one or more daily summaries");
        }
        jdbc.batchUpdate("""
                INSERT INTO admin_analytics_daily_summary(
                    property_id_hash, report_date, report_timezone, active_users, total_users,
                    new_users, sessions, engaged_sessions, views, event_count, key_events,
                    engagement_seconds, data_status, collected_at, finalized_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'PROVISIONAL', ?, NULL)
                ON DUPLICATE KEY UPDATE
                    report_timezone=VALUES(report_timezone), active_users=VALUES(active_users),
                    total_users=VALUES(total_users), new_users=VALUES(new_users), sessions=VALUES(sessions),
                    engaged_sessions=VALUES(engaged_sessions), views=VALUES(views),
                    event_count=VALUES(event_count), key_events=VALUES(key_events),
                    engagement_seconds=VALUES(engagement_seconds), data_status='PROVISIONAL',
                    collected_at=VALUES(collected_at), finalized_at=NULL
                """, summaries, BATCH_SIZE, (statement, item) -> {
            var metrics = item.metrics();
            statement.setString(1, propertyHash);
            statement.setDate(2, Date.valueOf(item.reportDate()));
            statement.setString(3, reportTimezone);
            statement.setLong(4, metrics.activeUsers());
            statement.setLong(5, metrics.totalUsers());
            statement.setLong(6, metrics.newUsers());
            statement.setLong(7, metrics.sessions());
            statement.setLong(8, metrics.engagedSessions());
            statement.setLong(9, metrics.views());
            statement.setLong(10, metrics.eventCount());
            statement.setBigDecimal(11, metrics.keyEvents());
            statement.setBigDecimal(12, metrics.engagementSeconds());
            statement.setTimestamp(13, Timestamp.from(collectedAt));
        });

        jdbc.update("""
                DELETE FROM admin_analytics_daily_breakdown
                 WHERE property_id_hash=? AND report_date BETWEEN ? AND ?
                """, propertyHash, Date.valueOf(rangeStart), Date.valueOf(rangeEnd));
        List<DailyBreakdown> breakdowns = archive.breakdowns().stream()
                .filter(value -> !value.reportDate().isBefore(rangeStart) && !value.reportDate().isAfter(rangeEnd))
                .toList();
        jdbc.batchUpdate("""
                INSERT INTO admin_analytics_daily_breakdown(
                    property_id_hash, report_date, breakdown_type, dimension_hash,
                    dimension_value, dimension_label, dimension_detail, active_users,
                    total_users, new_users, sessions, engaged_sessions, views, event_count,
                    key_events, engagement_seconds
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, breakdowns, BATCH_SIZE, (statement, item) -> {
            var metrics = item.metrics();
            String value = safeText(item.value(), "(not set)");
            String label = truncate(safeText(item.label(), value), 512);
            String detail = truncate(item.detail(), 512);
            statement.setString(1, propertyHash);
            statement.setDate(2, Date.valueOf(item.reportDate()));
            statement.setString(3, item.type().name());
            statement.setString(4, dimensionHash(item.type().name(), value, label, detail));
            statement.setString(5, value);
            statement.setString(6, label);
            statement.setString(7, detail);
            statement.setLong(8, metrics.activeUsers());
            statement.setLong(9, metrics.totalUsers());
            statement.setLong(10, metrics.newUsers());
            statement.setLong(11, metrics.sessions());
            statement.setLong(12, metrics.engagedSessions());
            statement.setLong(13, metrics.views());
            statement.setLong(14, metrics.eventCount());
            statement.setBigDecimal(15, metrics.keyEvents());
            statement.setBigDecimal(16, metrics.engagementSeconds());
        });

        jdbc.update("""
                UPDATE admin_analytics_daily_summary
                   SET data_status='FINAL', finalized_at=COALESCE(finalized_at, ?)
                 WHERE property_id_hash=? AND report_date < ? AND data_status <> 'FINAL'
                """, Timestamp.from(collectedAt), propertyHash, Date.valueOf(rangeStart));
        return summaries.size() + breakdowns.size();
    }

    public void markSuccess(long runId, Instant finishedAt, int apiRequests, int storedRows, String quotaJson) {
        jdbc.update("""
                UPDATE admin_analytics_collection_run
                   SET status='SUCCESS', finished_at=?, api_request_count=?, stored_row_count=?,
                       error_code=NULL, error_message=NULL, quota_json=?
                 WHERE id=?
                """, Timestamp.from(finishedAt), apiRequests, storedRows, quotaJson, runId);
    }

    public void markFailure(long runId, Instant finishedAt, String errorCode, String errorMessage) {
        try {
            jdbc.update("""
                    UPDATE admin_analytics_collection_run
                       SET status='FAILED', finished_at=?, error_code=?, error_message=?
                     WHERE id=?
                    """, Timestamp.from(finishedAt), truncate(errorCode, 64), truncate(errorMessage, 500), runId);
        } catch (DataAccessException ignored) {
            // Archival failures must never make the administrator application unavailable.
        }
    }

    public int nextRetryCount(String propertyHash, LocalDate targetDate) {
        try {
            Integer value = jdbc.queryForObject("""
                    SELECT COUNT(*)
                      FROM admin_analytics_collection_run
                     WHERE property_id_hash=? AND target_date=? AND status='FAILED'
                    """, Integer.class, propertyHash, Date.valueOf(targetDate));
            return value == null ? 0 : value;
        } catch (DataAccessException exception) {
            return 0;
        }
    }

    private String dimensionHash(String type, String value, String label, String detail) {
        try {
            String source = type + '\u001f' + value + '\u001f' + label + '\u001f' + safeText(detail, "");
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private String safeText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) return value;
        return value.substring(0, maxLength);
    }
}
