package com.example.toiletadmin.analytics.service;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public record AnalyticsExploreQuery(LocalDate from, LocalDate to, Instant until,
                                    LocalDate previousFrom, LocalDate previousTo, Instant previousUntil,
                                    boolean hourly, Map<String,String> filters,
                                    boolean excludeBots, boolean botClassificationAvailable) {
    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    public static AnalyticsExploreQuery resolve(String range, String from, String to,
                                                Map<String,String> filters, Clock clock) {
        return resolve(range,from,to,filters,clock,true);
    }
    public static AnalyticsExploreQuery resolve(String range, String from, String to,
                                                Map<String,String> filters, Clock clock, boolean excludeBots) {
        try {
            ZonedDateTime now = clock.instant().atZone(SEOUL);
            LocalDate end = now.toLocalDate();
            LocalDate start;
            switch (range == null ? "7d" : range) {
                case "today" -> start = end;
                case "yesterday" -> { end = end.minusDays(1); start = end; }
                case "7d" -> start = end.minusDays(6);
                case "30d" -> start = end.minusDays(29);
                case "custom" -> { start = LocalDate.parse(from); end = LocalDate.parse(to); }
                default -> throw new IllegalArgumentException();
            }
            long days = ChronoUnit.DAYS.between(start, end)+1;
            if (days < 1 || days > 93 || end.isAfter(now.toLocalDate())) throw new IllegalArgumentException();
            Map<String,String> clean = new LinkedHashMap<>();
            for (var filter : filters.entrySet()) {
                if (!Map.of("source",1,"channel",1,"device",1,"page",1,"country",1).containsKey(filter.getKey()))
                    throw new IllegalArgumentException();
                String value = filter.getValue() == null ? "" : filter.getValue().trim();
                if (value.length()>120 || value.chars().anyMatch(Character::isISOControl)) throw new IllegalArgumentException();
                if (!value.isEmpty()) clean.put(filter.getKey(),value);
            }
            LocalDate previousEnd = start.minusDays(1);
            LocalDate previousStart = previousEnd.minusDays(days-1);
            boolean ongoing = end.equals(now.toLocalDate());
            Instant until = ongoing ? clock.instant() : end.plusDays(1).atStartOfDay(SEOUL).toInstant();
            Instant previousUntil = ongoing ? previousEnd.atTime(now.toLocalTime()).atZone(SEOUL).toInstant()
                    : previousEnd.plusDays(1).atStartOfDay(SEOUL).toInstant();
            return new AnalyticsExploreQuery(start,end,until,previousStart,previousEnd,previousUntil,days==1,Map.copyOf(clean),excludeBots,false);
        } catch (RuntimeException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"조회 기간은 오늘까지 최대 93일이며 허용된 필터만 사용할 수 있습니다.");
        }
    }
    public AnalyticsExploreQuery previous() {
        return new AnalyticsExploreQuery(previousFrom,previousTo,previousUntil,previousFrom,previousTo,previousUntil,hourly,filters,excludeBots,botClassificationAvailable);
    }
    public AnalyticsExploreQuery withBotClassification(boolean available) {
        return new AnalyticsExploreQuery(from,to,until,previousFrom,previousTo,previousUntil,hourly,filters,excludeBots,available);
    }
    public AnalyticsExploreQuery includingBots() {
        return new AnalyticsExploreQuery(from,to,until,previousFrom,previousTo,previousUntil,hourly,filters,false,botClassificationAvailable);
    }
    public Instant start() { return from.atStartOfDay(SEOUL).toInstant(); }
}
