package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.DimensionRow;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.RealtimeMetrics;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.SummaryMetrics;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.TrendPoint;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ServiceAnalyticsRepository {

    private final JdbcTemplate jdbc;

    public ServiceAnalyticsRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean schemaReady() {
        Integer count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA=DATABASE()
                   AND TABLE_NAME IN ('service_analytics_event','service_analytics_daily_summary','service_analytics_daily_dimension')
                """, Integer.class);
        return count != null && count == 3;
    }

    public SummaryMetrics summary(LocalDate start, LocalDate end) {
        return jdbc.queryForObject("""
                SELECT COALESCE(SUM(active_users),0), COALESCE(SUM(new_users),0),
                       COALESCE(SUM(sessions),0), COALESCE(SUM(views),0),
                       COALESCE(SUM(engaged_sessions),0), COALESCE(SUM(key_events),0),
                       COALESCE(SUM(total_engagement_seconds),0)
                  FROM service_analytics_daily_summary
                 WHERE analytics_date BETWEEN ? AND ?
                """, (rs, row) -> summary(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4),
                        rs.getLong(5), rs.getLong(6), rs.getLong(7)), Date.valueOf(start), Date.valueOf(end));
    }

    public List<TrendPoint> trend(LocalDate start, LocalDate end) {
        return jdbc.query("""
                SELECT analytics_date, active_users, new_users, sessions, views, key_events
                  FROM service_analytics_daily_summary
                 WHERE analytics_date BETWEEN ? AND ?
                 ORDER BY analytics_date
                """, (rs, row) -> new TrendPoint(rs.getDate(1).toLocalDate().toString(), rs.getLong(2),
                        rs.getLong(3), rs.getLong(4), rs.getLong(5), rs.getLong(6)),
                Date.valueOf(start), Date.valueOf(end));
    }

    public List<DimensionRow> dimensions(String type, LocalDate start, LocalDate end, int limit) {
        return jdbc.query("""
                SELECT dimension_key, MAX(dimension_label), COALESCE(SUM(active_users),0),
                       COALESCE(SUM(views),0), COALESCE(SUM(sessions),0), COALESCE(SUM(event_count),0),
                       COALESCE(SUM(key_events),0), COALESCE(SUM(engagement_seconds),0)
                  FROM service_analytics_daily_dimension
                 WHERE dimension_type=? AND analytics_date BETWEEN ? AND ?
                 GROUP BY dimension_key
                 ORDER BY CASE WHEN ? IN ('EVENT','EVENT_DETAIL') THEN SUM(event_count)
                               WHEN ? IN ('CHANNEL','SOURCE') THEN SUM(sessions)
                               WHEN ?='PAGE' THEN SUM(views)
                               ELSE SUM(active_users) END DESC,
                          dimension_key
                 LIMIT ?
                """, (rs, row) -> {
                    long active = rs.getLong(3);
                    return new DimensionRow(rs.getString(1), rs.getString(2), rs.getString(1), active,
                            rs.getLong(4), rs.getLong(5), rs.getLong(6), rs.getLong(7),
                            active == 0 ? 0 : (double) rs.getLong(8) / active);
                }, type, Date.valueOf(start), Date.valueOf(end), type, type, type, limit);
    }

    public RealtimeMetrics realtime(Instant since) {
        return jdbc.queryForObject("""
                SELECT COUNT(DISTINCT visitor_hash), COALESCE(SUM(event_name='page_view'),0),
                       COUNT(*), COALESCE(SUM(key_event),0)
                  FROM service_analytics_event
                 WHERE occurred_at>=?
                """, (rs, row) -> new RealtimeMetrics(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4)),
                Timestamp.from(since));
    }

    public Instant lastCalculatedAt() {
        return jdbc.queryForObject("SELECT MAX(calculated_at) FROM service_analytics_daily_summary",
                (rs, row) -> rs.getTimestamp(1) == null ? null : rs.getTimestamp(1).toInstant());
    }

    public Instant lastEventAt() {
        return jdbc.queryForObject("SELECT MAX(occurred_at) FROM service_analytics_event",
                (rs, row) -> rs.getTimestamp(1) == null ? null : rs.getTimestamp(1).toInstant());
    }

    private static SummaryMetrics summary(long active, long newUsers, long sessions, long views,
                                          long engaged, long keyEvents, long engagementSeconds) {
        return new SummaryMetrics(active, newUsers, sessions, views, engaged, keyEvents,
                sessions == 0 ? 0 : (double) engaged / sessions,
                active == 0 ? 0 : (double) engagementSeconds / active);
    }
}
