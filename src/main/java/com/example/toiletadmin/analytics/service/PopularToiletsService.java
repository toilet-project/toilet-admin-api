package com.example.toiletadmin.analytics.service;

import java.time.*;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PopularToiletsService {
    public record Row(long toiletId,String name,String address,long views,long totalViews,long likes) { }
    public record Report(String status,String from,String to,String collectedSince,long views,long facilities,
                         int page,int size,boolean hasMore,String query,String sort,List<Row> items) { }
    private final JdbcTemplate jdbc;
    private final Clock clock;
    @Autowired public PopularToiletsService(JdbcTemplate jdbc) {this(jdbc,Clock.systemUTC());}
    public PopularToiletsService(JdbcTemplate jdbc,Clock clock) {this.jdbc=jdbc;this.clock=clock;}
    protected boolean ready() {
        return Integer.valueOf(3).equals(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('toilet_view_stats','toilet_view_daily','toilet_like')",Integer.class));
    }
    @Transactional(readOnly=true)
    public Report report(String range,String from,String to,String query,String sort,int page,int size) {
        LocalDate today=LocalDate.now(clock.withZone(ZoneId.of("Asia/Seoul"))),start,end;
        switch(range) {
            case "today" -> {start=today;end=today;}
            case "yesterday" -> {start=today.minusDays(1);end=start;}
            case "7d" -> {start=today.minusDays(6);end=today;}
            case "30d" -> {start=today.minusDays(29);end=today;}
            case "custom" -> {try {start=LocalDate.parse(from);end=LocalDate.parse(to);}catch(RuntimeException e){throw new IllegalArgumentException("날짜를 확인해 주세요.");}}
            default -> throw new IllegalArgumentException("조회 기간을 확인해 주세요.");
        }
        String q=query==null?"":query.strip();
        if(start.isAfter(end) || end.isAfter(today) || start.getYear()<2000 || java.time.temporal.ChronoUnit.DAYS.between(start,end)>92
                || q.length()>80 || page<0 || page>10000 || size<1 || size>50 || !Set.of("views","likes","name").contains(sort))
            throw new IllegalArgumentException("조회 조건을 확인해 주세요.");
        if(!ready())return new Report("NOT_READY",start.toString(),end.toString(),null,0,0,page,size,false,q,sort,List.of());
        String pattern="%"+q.replace("!","!!").replace("%","!%").replace("_","!_")+"%";
        String filter=" d.view_date BETWEEN ? AND ? AND t.visibility_status='VISIBLE' AND (t.name LIKE ? ESCAPE '!' OR t.road_address LIKE ? ESCAPE '!' OR t.jibun_address LIKE ? ESCAPE '!')";
        Object[] args={start,end,pattern,pattern,pattern};
        var totals=jdbc.queryForObject("SELECT COALESCE(SUM(d.views),0),COUNT(DISTINCT d.toilet_id) FROM toilet_view_daily d JOIN toilet t ON t.toilet_id=d.toilet_id WHERE"+filter,(r,n)->new long[]{r.getLong(1),r.getLong(2)},args);
        String order=switch(sort){case "likes"->"likes DESC,views DESC,t.toilet_id";case "name"->"t.name,t.toilet_id";default->"views DESC,t.toilet_id";};
        var params=new java.util.ArrayList<Object>(List.of(args));params.add(size+1);params.add(page*size);
        List<Row> rows=jdbc.query("""
                SELECT t.toilet_id,t.name,COALESCE(NULLIF(t.road_address,''),t.jibun_address,'') AS address,
                       SUM(d.views) AS views,MAX(s.total_views) AS total_views,
                       (SELECT COUNT(*) FROM toilet_like l JOIN app_user u ON u.user_id=l.user_id AND u.status='ACTIVE' WHERE l.toilet_id=t.toilet_id) AS likes
                FROM toilet_view_daily d JOIN toilet t ON t.toilet_id=d.toilet_id
                JOIN toilet_view_stats s ON s.toilet_id=t.toilet_id WHERE
                """+filter+" GROUP BY t.toilet_id,t.name,t.road_address,t.jibun_address ORDER BY "+order+" LIMIT ? OFFSET ?",
                (r,n)->new Row(r.getLong(1),r.getString(2),r.getString(3),r.getLong(4),r.getLong(5),r.getLong(6)),params.toArray());
        LocalDateTime first=jdbc.queryForObject("SELECT MIN(first_view_at) FROM toilet_view_stats",LocalDateTime.class);
        return new Report("READY",start.toString(),end.toString(),first==null?null:first.atOffset(ZoneOffset.ofHours(9)).toString(),totals[0],totals[1],page,size,rows.size()>size,q,sort,rows.subList(0,Math.min(size,rows.size())));
    }
}
