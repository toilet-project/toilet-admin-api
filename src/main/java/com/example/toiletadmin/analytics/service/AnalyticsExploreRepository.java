package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.dto.AnalyticsExploreResponse.*;
import java.sql.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Bounded aggregate reads only. No identifiers or individual event rows leave this repository. */
@Repository
public class AnalyticsExploreRepository {
    public static final int ROW_LIMIT = 500;
    private final JdbcTemplate jdbc;
    private static final Map<String,String> COLUMNS = Map.ofEntries(
            Map.entry("source","source_key"), Map.entry("channel","channel_key"), Map.entry("device","device_type"),
            Map.entry("page","page_key"), Map.entry("country","country_code"), Map.entry("os","os_family"), Map.entry("browser","browser_family"),
            Map.entry("city","city_name"), Map.entry("event","event_name"), Map.entry("screen","event_detail"),
            Map.entry("client","client_context"), Map.entry("evidence","client_context_evidence"),
            Map.entry("entry","acquisition_evidence"),Map.entry("navigation","entry_navigation"),Map.entry("landing","page_key"));
    private static final String COUNTS = """
        COUNT(DISTINCT visitor_hash) AS visitors,
        COUNT(DISTINCT CASE WHEN event_name='session_start' THEN session_hash END) AS sessions,
        SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS views,
        COUNT(*) AS events, SUM(CASE WHEN key_event=TRUE THEN 1 ELSE 0 END) AS key_events,
        SUM(engagement_seconds) AS engagement,
        SUM(CASE WHEN success_status=TRUE THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN success_status=FALSE THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN success_status IS NULL AND event_name IN ('report_submit','review_submit','login_result','toilet_search','nearby_search') THEN 1 ELSE 0 END) AS unspecified,
        SUM(CASE WHEN event_name IN ('toilet_search','nearby_search') AND result_count_bucket='0' THEN 1 ELSE 0 END) AS empty_results
        """;
    public AnalyticsExploreRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    private record Where(String sql, List<Object> args) { }
    private Where where(AnalyticsExploreQuery q) {
        StringBuilder sql=new StringBuilder(" WHERE occurred_date BETWEEN ? AND ? AND occurred_at>=? AND occurred_at<?");
        List<Object> args=new ArrayList<>(List.of(java.sql.Date.valueOf(q.from()),java.sql.Date.valueOf(q.to()),Timestamp.from(q.start()),Timestamp.from(q.until())));
        if(q.botClassificationAvailable() && q.excludeBots()) sql.append(" AND traffic_class<>'BOT'");
        q.filters().entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e->{
            if(e.getKey().equals("unattributed")) {
                sql.append(" AND source_key IN ('none','unknown') AND channel_key IN ('Direct','Unassigned')");
                return;
            }
            String column=column(e.getKey(),q);
            if(column==null) throw new IllegalArgumentException("Unsupported dimension");
            if(e.getKey().equals("page") || e.getKey().equals("landing")) {
                sql.append(" AND session_hash IN (SELECT session_hash FROM service_analytics_event WHERE occurred_date BETWEEN ? AND ? AND occurred_at>=? AND occurred_at<? AND event_name='")
                        .append(e.getKey().equals("landing")?"session_start":"page_view").append("' AND page_key=?");
                if(q.botClassificationAvailable() && q.excludeBots()) sql.append(" AND traffic_class<>'BOT'");
                sql.append(')');
                args.addAll(List.of(java.sql.Date.valueOf(q.from()),java.sql.Date.valueOf(q.to()),Timestamp.from(q.start()),Timestamp.from(q.until()),e.getValue()));
                return;
            }
            sql.append(" AND ").append(column).append("=?"); args.add(e.getValue());
        });
        return new Where(sql.toString(),args);
    }
    private <T> List<T> query(String sql,List<Object> args,org.springframework.jdbc.core.RowMapper<T> mapper) {
        return jdbc.query(connection->{
            PreparedStatement statement=connection.prepareStatement(sql);
            statement.setQueryTimeout(8);
            for(int i=0;i<args.size();i++) statement.setObject(i+1,args.get(i));
            return statement;
        },mapper);
    }
    private static Metrics metrics(ResultSet rs) throws SQLException {
        return new Metrics(rs.getLong("visitors"),rs.getLong("sessions"),rs.getLong("views"),rs.getLong("events"),
                rs.getLong("key_events"),rs.getLong("engagement"),rs.getLong("successes"),rs.getLong("failures"),
                rs.getLong("unspecified"),rs.getLong("empty_results"));
    }
    public List<Point> daily(AnalyticsExploreQuery q) {
        Where w=where(q);
        return query("SELECT occurred_date AS bucket,"+COUNTS+" FROM service_analytics_event"+w.sql()+" GROUP BY occurred_date ORDER BY occurred_date",
                w.args(),(rs,n)->new Point(rs.getDate("bucket").toLocalDate().toString(),metrics(rs)));
    }
    public List<Point> hourly(AnalyticsExploreQuery q) {
        Where w=where(q); List<Object> args=new ArrayList<>(); args.add(Timestamp.from(q.start()));args.addAll(w.args());
        return query("SELECT FLOOR(TIMESTAMPDIFF(SECOND,?,occurred_at)/3600) AS bucket,"+COUNTS+
                " FROM service_analytics_event"+w.sql()+" GROUP BY bucket ORDER BY bucket",args,
                (rs,n)->new Point(String.format("%02d:00",rs.getInt("bucket")),metrics(rs)));
    }
    public List<Row> dimension(String dimension, AnalyticsExploreQuery q) {
        String column=column(dimension,q); if(column==null) throw new IllegalArgumentException("Unsupported dimension");
        Where w=where(q);
        String extra=switch(dimension) {
            case "screen" -> " AND event_name='screen_view'";
            default -> "";
        };
        String counts=COUNTS;
        if(!Set.of("source","channel","client","evidence","entry","navigation").contains(dimension)) counts=counts.replace(
                "COUNT(DISTINCT CASE WHEN event_name='session_start' THEN session_hash END) AS sessions", "COUNT(DISTINCT session_hash) AS sessions");
        // Sum daily visitor counts explicitly; never present these as period-wide unique people.
        String order=switch(dimension) { case "source","channel","client","evidence","entry","navigation"->"sessions";case "page"->"views";case "event","screen"->"events";default->"visitors";};
        String sql="SELECT dimension_key,SUM(visitors) AS visitors,SUM(sessions) AS sessions,SUM(views) AS views,SUM(events) AS events,"+
                "SUM(key_events) AS key_events,SUM(engagement) AS engagement,SUM(successes) AS successes,SUM(failures) AS failures,"+
                "SUM(unspecified) AS unspecified,SUM(empty_results) AS empty_results FROM (SELECT "+column+" AS dimension_key,occurred_date,"+
                counts+" FROM service_analytics_event"+w.sql()+extra+" GROUP BY "+column+",occurred_date) d GROUP BY dimension_key ORDER BY "+order+" DESC,dimension_key LIMIT "+(ROW_LIMIT+1);
        return query(sql,w.args(),(rs,n)->new Row(rs.getString("dimension_key"),metrics(rs)));
    }
    public List<Flow> flows(AnalyticsExploreQuery q) {
        return List.of(flow(q,"검색 후 길찾기",new String[]{"검색","결과 선택","상세 열기","길찾기"},
                        new String[]{"event_name='toilet_search'","event_name='search_result_select'","event_name='toilet_detail_open'","event_name='directions_click'"}),
                flow(q,"제보 완료",new String[]{"제보 시작","제보 성공"},new String[]{"event_name='report_start'","event_name='report_submit' AND success_status=TRUE"}),
                flow(q,"리뷰 완료",new String[]{"리뷰 작성 화면","리뷰 성공"},new String[]{"event_name='screen_view' AND event_detail='review_write'","event_name='review_submit' AND success_status=TRUE"}));
    }
    private Flow flow(AnalyticsExploreQuery q,String name,String[] labels,String[] predicates) {
        Where w=where(q);
        StringBuilder sql=new StringBuilder("WITH filtered AS (SELECT event_id,session_hash,event_name,event_detail,success_status FROM service_analytics_event"+w.sql()+")");
        for(int i=0;i<labels.length;i++) {
            sql.append(", s").append(i).append(" AS (SELECT e.session_hash,MIN(e.event_id) AS seq FROM filtered e ");
            if(i>0)sql.append("JOIN s").append(i-1).append(" p ON p.session_hash=e.session_hash AND e.event_id>p.seq ");
            sql.append("WHERE ").append(predicates[i]).append(" GROUP BY e.session_hash)");
        }
        sql.append(" SELECT ");
        for(int i=0;i<labels.length;i++) { if(i>0)sql.append(',');sql.append("(SELECT COUNT(*) FROM s").append(i).append(") AS stage").append(i); }
        return query(sql.toString(),w.args(),(rs,n)->{
            List<Step> steps=new ArrayList<>();for(int i=0;i<labels.length;i++) steps.add(new Step(labels[i],rs.getLong("stage"+i)));
            return new Flow(name,steps);
        }).getFirst();
    }
    public long[] quality(AnalyticsExploreQuery q) {
        Where w=where(q);
        String sql="""
            SELECT SUM(unknown_views), SUM(unattributed), SUM(internal), SUM(repeated) FROM (
            SELECT SUM(CASE WHEN event_name='page_view' AND page_key='/other' THEN 1 ELSE 0 END) AS unknown_views,
             COUNT(DISTINCT CASE WHEN event_name='session_start' AND source_key IN ('none','unknown') THEN session_hash END) AS unattributed,
             COUNT(DISTINCT CASE WHEN event_name='session_start' AND channel_key='Internal' THEN session_hash END) AS internal,
             SUM(CASE WHEN event_name='session_start' THEN 1 ELSE 0 END)-COUNT(DISTINCT CASE WHEN event_name='session_start' THEN session_hash END) AS repeated
            FROM service_analytics_event
            """+w.sql()+" GROUP BY occurred_date) daily";
        return query(sql,w.args(),(rs,n)->new long[]{rs.getLong(1),rs.getLong(2),rs.getLong(3),rs.getLong(4)}).getFirst();
    }
    public java.time.LocalDate firstEventDate() {
        return jdbc.queryForObject("SELECT MIN(occurred_date) FROM service_analytics_event",(rs,n)->
                rs.getDate(1)==null?null:rs.getDate(1).toLocalDate());
    }
    private static String column(String dimension, AnalyticsExploreQuery q) {
        if (!q.clientContextAvailable() && dimension.equals("client")) return "'UNKNOWN'";
        if (!q.clientContextAvailable() && dimension.equals("evidence")) return "'UNCLASSIFIED'";
        if (!q.entryEvidenceAvailable() && dimension.equals("entry")) return "'UNRECORDED'";
        if (!q.entryEvidenceAvailable() && dimension.equals("navigation")) return "'UNKNOWN'";
        if (q.clientContextAvailable() && Set.of("source","channel").contains(dimension)) {
            // Split only unattributed traffic by observed app context. A known referrer or
            // campaign remains authoritative; the stored acquisition fields are never rewritten.
            // Use the same expression for rows AND filters (including comparisons and CSV).
            return "CASE WHEN source_key IN ('none','unknown') AND channel_key IN ('Direct','Unassigned')"
                    + " AND client_context_evidence IN ('REQUEST_UA','LOG_UA')"
                    + " AND client_context IN ('KAKAOTALK','LINE','NAVER_APP','INSTAGRAM','FACEBOOK','GOOGLE_APP','ANDROID_WEBVIEW','IOS_WEBVIEW')"
                    + " THEN CONCAT('unattributed:',client_context) ELSE " + COLUMNS.get(dimension) + " END";
        }
        return COLUMNS.get(dimension);
    }
    public boolean clientContextAvailable() {
        return ServiceAnalyticsRepository.columnAvailable(jdbc,"client_context")
                && ServiceAnalyticsRepository.columnAvailable(jdbc,"client_context_evidence");
    }
    public boolean entryEvidenceAvailable() {
        return ServiceAnalyticsRepository.columnAvailable(jdbc,"acquisition_evidence")
                && ServiceAnalyticsRepository.columnAvailable(jdbc,"entry_navigation");
    }

    private static final List<String> REVIEW_KEYS=List.of("BOT_SIGNAL","LEGACY_OR_MIXED","NO_PAGE_VIEW",
            "OBSERVED_ACTIVITY","APP_CONTEXT","REENTRY","PASSIVE_SINGLE_VIEW","TIMED_SINGLE_VIEW","OTHER_UNFLAGGED");
    private record ClueResult(String collection,EntryClue row,long total,long orphanEvents,List<ReviewCount> categories) { }
    /** Observations, not human/bot identity inference. Totals cover every started session before the row cap. */
    public EntryClues entryClues(AnalyticsExploreQuery q) {
        Where w=where(q);
        String traffic=q.botClassificationAvailable()?"traffic_class":"'LEGACY'";
        String categoryTotals=REVIEW_KEYS.stream().map(key->"COALESCE(SUM(CASE WHEN review_key='"+key+"' THEN sessions ELSE 0 END),0) AS "+key).collect(java.util.stream.Collectors.joining(","));
        String sql="WITH filtered AS (SELECT event_id,occurred_date,session_hash,event_name,page_key,source_key,channel_key,device_type,os_family,browser_family,engagement_seconds,"
                +column("client",q)+" AS client,"+column("evidence",q)+" AS evidence,"+column("entry",q)+" AS entry,"+column("navigation",q)+" AS navigation,"+traffic+" AS traffic FROM service_analytics_event"+w.sql()+"),"
                +" starts AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY occurred_date,session_hash ORDER BY event_id) AS seq FROM filtered WHERE event_name='session_start'),"
                +" legacy_starts AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY occurred_date,session_hash ORDER BY event_id) AS seq FROM filtered WHERE event_name='session_start' AND source_key IN ('none','unknown') AND channel_key IN ('Direct','Unassigned')),"
                +" activity AS (SELECT occurred_date,session_hash,COUNT(*) AS events,SUM(CASE WHEN event_name='session_start' THEN 1 ELSE 0 END) AS starts,"
                +"SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS views,"
                +"MAX(CASE WHEN event_name='toilet_detail_open' THEN 1 ELSE 0 END) AS detail,MAX(CASE WHEN event_name IN ('toilet_search','nearby_search') THEN 1 ELSE 0 END) AS search_used,"
                +"MAX(CASE WHEN event_name NOT IN ('session_start','page_view','engagement') THEN 1 ELSE 0 END) AS used,COALESCE(SUM(engagement_seconds),0) AS engagement,"
                +"MAX(CASE WHEN traffic='BOT' THEN 1 ELSE 0 END) AS bot,MAX(CASE WHEN traffic='UNFLAGGED' THEN 1 ELSE 0 END) AS unflagged,"
                +"MAX(CASE WHEN traffic NOT IN ('BOT','UNFLAGGED') THEN 1 ELSE 0 END) AS legacy FROM filtered GROUP BY occurred_date,session_hash),"
                +" reviewed AS (SELECT s.device_type,s.os_family,s.browser_family,s.page_key,s.client,s.entry,s.navigation,s.source_key,s.channel_key,a.views,a.detail,a.search_used,a.engagement,"
                +"CASE WHEN a.bot+a.unflagged+a.legacy>1 THEN 'MIXED' WHEN a.bot=1 THEN 'BOT' WHEN a.unflagged=1 THEN 'UNFLAGGED' ELSE 'LEGACY' END AS traffic,"
                +"CASE WHEN a.legacy=1 OR a.bot+a.unflagged>1 THEN 'LEGACY_OR_MIXED' WHEN a.bot=1 THEN 'BOT_SIGNAL' "
                +"WHEN a.views=0 THEN 'NO_PAGE_VIEW' WHEN a.used=1 THEN 'OBSERVED_ACTIVITY' "
                +"WHEN s.evidence IN ('REQUEST_UA','LOG_UA') AND s.client IN ('KAKAOTALK','LINE','NAVER_APP','INSTAGRAM','FACEBOOK','GOOGLE_APP','ANDROID_WEBVIEW','IOS_WEBVIEW') THEN 'APP_CONTEXT' "
                +"WHEN s.navigation IN ('RELOAD','HISTORY','CONTINUATION') THEN 'REENTRY' "
                +"WHEN a.views=1 AND s.source_key IN ('none','unknown') AND s.channel_key IN ('Direct','Unassigned') THEN CASE WHEN a.engagement=0 THEN 'PASSIVE_SINGLE_VIEW' ELSE 'TIMED_SINGLE_VIEW' END "
                +"WHEN a.engagement>0 THEN 'OBSERVED_ACTIVITY' ELSE 'OTHER_UNFLAGGED' END AS review_key "
                +"FROM starts s JOIN activity a ON a.occurred_date=s.occurred_date AND a.session_hash=s.session_hash WHERE s.seq=1),"
                +" cohorts AS (SELECT device_type,os_family,browser_family,page_key,client,entry,navigation,source_key,channel_key,traffic,review_key,COUNT(*) AS sessions,"
                +"SUM(views) AS views,SUM(detail) AS details,SUM(search_used) AS searches,SUM(engagement) AS engagement FROM reviewed "
                +"GROUP BY device_type,os_family,browser_family,page_key,client,entry,navigation,source_key,channel_key,traffic,review_key),"
                // Preserve the original unknown-source rows, grouping and independent cap for already-open clients.
                +" legacy_cohorts AS (SELECT s.device_type,s.os_family,s.browser_family,s.page_key,s.client,s.entry,s.navigation,"
                +"NULL AS source_key,NULL AS channel_key,NULL AS traffic,NULL AS review_key,COUNT(*) AS sessions,"
                +"SUM(a.views) AS views,SUM(a.detail) AS details,SUM(a.search_used) AS searches,SUM(a.engagement) AS engagement "
                +"FROM legacy_starts s JOIN activity a ON a.occurred_date=s.occurred_date AND a.session_hash=s.session_hash WHERE s.seq=1 "
                +"GROUP BY s.device_type,s.os_family,s.browser_family,s.page_key,s.client,s.entry,s.navigation),"
                +" ranked AS (SELECT 'review' AS collection,c.*,ROW_NUMBER() OVER(ORDER BY sessions DESC,device_type,os_family,browser_family,page_key,client,entry,navigation,source_key,channel_key,traffic,review_key) AS rank_position FROM cohorts c "
                +"UNION ALL SELECT 'legacy' AS collection,l.*,ROW_NUMBER() OVER(ORDER BY sessions DESC,device_type,os_family,browser_family,page_key,client,entry,navigation) AS rank_position FROM legacy_cohorts l),"
                +" totals AS (SELECT COALESCE(SUM(sessions),0) AS total_sessions,"+categoryTotals+" FROM cohorts),"
                +" orphan AS (SELECT COALESCE(SUM(events),0) AS orphan_events FROM activity WHERE starts=0) "
                +"SELECT c.*,t.*,o.orphan_events FROM totals t CROSS JOIN orphan o LEFT JOIN ranked c ON c.rank_position<=101 "
                +"ORDER BY c.collection,c.rank_position";
        List<ClueResult> result=query(sql,w.args(),(rs,n)->{
            List<ReviewCount> categories=new ArrayList<>();
            for(String key:REVIEW_KEYS) categories.add(new ReviewCount(key,rs.getLong(key)));
            EntryClue row=rs.getString("collection")==null?null:new EntryClue(rs.getString("device_type"),rs.getString("os_family"),rs.getString("browser_family"),rs.getString("page_key"),rs.getString("client"),rs.getString("entry"),rs.getString("navigation"),rs.getLong("sessions"),rs.getLong("views"),rs.getLong("details"),rs.getLong("searches"),rs.getLong("engagement"),rs.getString("review_key"),rs.getString("source_key"),rs.getString("channel_key"),rs.getString("traffic"));
            return new ClueResult(rs.getString("collection"),row,rs.getLong("total_sessions"),rs.getLong("orphan_events"),List.copyOf(categories));
        });
        List<EntryClue> legacy=result.stream().filter(r->"legacy".equals(r.collection())).map(ClueResult::row).toList();
        List<EntryClue> all=result.stream().filter(r->"review".equals(r.collection())).map(ClueResult::row).toList();
        List<EntryClue> rows=all.stream().limit(100).toList();
        ClueResult totals=result.getFirst();
        return new EntryClues(true,q.entryEvidenceAvailable(),legacy.size()>100,legacy.stream().limit(100).toList(),
                new SessionReview(totals.total(),rows.stream().mapToLong(EntryClue::sessions).sum(),totals.orphanEvents(),totals.categories(),all.size()>100,rows));
    }
    public boolean botClassificationAvailable() {
        return ServiceAnalyticsRepository.botClassificationAvailable(jdbc);
    }
    /** Counts use the same period/dimensions before exclusion, never origin-request totals. */
    public long[] trafficCoverage(AnalyticsExploreQuery q) {
        Where w=where(q.includingBots());
        String counts=q.botClassificationAvailable()
                ? "SUM(CASE WHEN traffic_class='BOT' THEN 1 ELSE 0 END), SUM(CASE WHEN traffic_class='UNFLAGGED' THEN 1 ELSE 0 END), SUM(CASE WHEN traffic_class NOT IN ('BOT','UNFLAGGED') THEN 1 ELSE 0 END)"
                : "0,0,COUNT(*)";
        return query("SELECT "+counts+" FROM service_analytics_event"+w.sql(),w.args(),
                (rs,n)->new long[]{rs.getLong(1),rs.getLong(2),rs.getLong(3)}).getFirst();
    }
}
