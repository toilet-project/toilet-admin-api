package com.example.toiletadmin.analytics.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record AnalyticsExploreResponse(
        Instant generatedAt, String from, String to, String previousFrom, String previousTo,
        String cutoff, boolean hourly, boolean detailed, boolean comparisonAvailable,
        String comparisonNote, String visitorDefinition, Metrics current, Metrics previous,
        List<Point> trend, List<Point> previousTrend, Map<String, List<Row>> dimensions,
        Map<String, List<Row>> previousDimensions, List<Flow> flows,
        Quality quality, List<String> notices, Map<String, String> filters, BotFilter botFilter, EntryClues entryClues) {

    public record EntryClues(boolean available, boolean evidenceAvailable, boolean truncated, List<EntryClue> rows) { }
    public record EntryClue(String device,String os,String browser,String landing,String client,String entry,String navigation,
                            long sessions,long views,long withDetail,long withSearch,long engagementSeconds) { }

    public record BotFilter(boolean excludeBots, boolean schemaAvailable, boolean toggleAvailable,
                            long botEvents, long unflaggedEvents, long legacyEvents, String note) { }

    public record Metrics(long visitors, long sessions, long views, long events, long keyEvents,
                          long engagementSeconds, long successes, long failures, long unspecified,
                          long emptyResults) {
        public static Metrics zero() { return new Metrics(0,0,0,0,0,0,0,0,0,0); }
        public Metrics plus(Metrics x) {
            return new Metrics(visitors+x.visitors, sessions+x.sessions, views+x.views, events+x.events,
                    keyEvents+x.keyEvents, engagementSeconds+x.engagementSeconds, successes+x.successes,
                    failures+x.failures, unspecified+x.unspecified, emptyResults+x.emptyResults);
        }
    }
    public record Point(String key, Metrics metrics) { }
    public record Row(String key, Metrics metrics) { }
    public record Step(String name, long sessions) { }
    public record Flow(String name, List<Step> steps) { }
    public record Quality(long unknownPageViews, long unattributedSessions, long internalSessions,
                          long duplicateStarts, boolean rowsTruncated, Instant lastCalculatedAt,
                          Instant lastEventAt) { }
}
