package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.toiletadmin.analytics.service.DailyAnalyticsArchive.ArchiveMetrics;
import com.example.toiletadmin.analytics.service.DailyAnalyticsArchive.BreakdownType;
import com.example.toiletadmin.analytics.service.DailyAnalyticsArchive.DailyBreakdown;
import com.example.toiletadmin.analytics.service.DailyAnalyticsArchive.DailySummary;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

class AnalyticsDailyArchiveRepositoryTest {

    @Test
    void replacesTheRefreshWindowAndFinalizesOlderDays() {
        var dataSource = new DriverManagerDataSource(
                "jdbc:h2:mem:analytics-daily-repository;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        new ResourceDatabasePopulator(new ClassPathResource("analytics-daily-archive-h2.sql")).execute(dataSource);
        var jdbc = new JdbcTemplate(dataSource);
        var repository = new AnalyticsDailyArchiveRepository(jdbc);
        String propertyHash = "a".repeat(64);
        LocalDate start = LocalDate.parse("2026-09-15");
        LocalDate end = LocalDate.parse("2026-09-16");
        Instant collectedAt = Instant.parse("2026-09-17T07:30:00Z");
        jdbc.update("""
                INSERT INTO admin_analytics_daily_summary(
                    property_id_hash, report_date, report_timezone, data_status, collected_at
                ) VALUES(?,?,?,'PROVISIONAL',?)
                """, propertyHash, Date.valueOf(start.minusDays(1)), "Asia/Seoul", Timestamp.from(collectedAt));

        DailyAnalyticsArchive first = archive(start, end, "/old");
        assertThat(repository.replaceRange(propertyHash, "Asia/Seoul", start, end, first, collectedAt)).isEqualTo(3);
        DailyAnalyticsArchive second = archive(start, end, "/new");
        assertThat(repository.replaceRange(propertyHash, "Asia/Seoul", start, end, second, collectedAt)).isEqualTo(3);

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM admin_analytics_daily_breakdown", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT dimension_value FROM admin_analytics_daily_breakdown", String.class))
                .isEqualTo("/new");
        assertThat(jdbc.queryForObject("""
                SELECT data_status FROM admin_analytics_daily_summary
                 WHERE property_id_hash=? AND report_date=?
                """, String.class, propertyHash, Date.valueOf(start.minusDays(1)))).isEqualTo("FINAL");
        assertThat(jdbc.queryForObject("""
                SELECT data_status FROM admin_analytics_daily_summary
                 WHERE property_id_hash=? AND report_date=?
                """, String.class, propertyHash, Date.valueOf(end))).isEqualTo("PROVISIONAL");
    }

    @Test
    void recordsACompletedRunForTheTargetDate() {
        var dataSource = new DriverManagerDataSource(
                "jdbc:h2:mem:analytics-run-repository;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        new ResourceDatabasePopulator(new ClassPathResource("analytics-daily-archive-h2.sql")).execute(dataSource);
        var repository = new AnalyticsDailyArchiveRepository(new JdbcTemplate(dataSource));
        String propertyHash = "b".repeat(64);
        LocalDate target = LocalDate.parse("2026-09-16");
        Instant now = Instant.parse("2026-09-17T07:30:00Z");

        long runId = repository.startRun(propertyHash, target, target.minusDays(13), target, now, 0).orElseThrow();
        repository.markSuccess(runId, now, 3, 12, "{}");

        assertThat(repository.alreadySucceeded(propertyHash, target)).isTrue();
    }

    private DailyAnalyticsArchive archive(LocalDate start, LocalDate end, String pagePath) {
        List<DailySummary> summaries = List.of(
                new DailySummary(start, ArchiveMetrics.empty()),
                new DailySummary(end, ArchiveMetrics.empty()));
        List<DailyBreakdown> breakdowns = List.of(
                new DailyBreakdown(end, BreakdownType.PAGE, pagePath, "급똥", pagePath, ArchiveMetrics.empty()));
        return new DailyAnalyticsArchive(summaries, breakdowns, 3);
    }
}
