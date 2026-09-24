package com.example.toiletadmin.analytics.service;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.h2.jdbcx.JdbcDataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/** Test classpath only: aggregate SQL over a disposable H2 snapshot. Never loads production configuration. */
public final class AnalyticsPreviewServer {
    private static final Set<String> ASSETS=Set.of("service-analytics.html","service-analytics.js","service-analytics.css","origin-bots.js",
            "dashboard.css","admin-shell.css","admin-shell.js","admin-session.css");
    public static void main(String[] args) throws Exception {
        int port=args.length>0?Integer.parseInt(args[0]):8187;
        int ttl=args.length>1?Math.min(7200,Integer.parseInt(args[1])):3600;
        String snapshotPath=System.getenv("ANALYTICS_PREVIEW_SNAPSHOT");
        boolean realSnapshot=snapshotPath!=null && !snapshotPath.isBlank();
        String gatewayToken=System.getenv("PREVIEW_GATEWAY_TOKEN");
        if(realSnapshot && (gatewayToken==null || !gatewayToken.matches("[a-f0-9]{64}")))throw new IllegalStateException("Protected preview token required");
        var ds=new JdbcDataSource(); ds.setURL("jdbc:h2:mem:analytics_preview;MODE=MySQL;DB_CLOSE_DELAY=-1");
        var jdbc=new JdbcTemplate(ds);
        createSchema(jdbc);
        final Clock clock=realSnapshot?AnalyticsSnapshotLoader.load(jdbc,Path.of(snapshotPath)):Clock.systemUTC();
        if(!realSnapshot)seed(jdbc,clock);
        var summaries=new ServiceAnalyticsRepository(jdbc) {
            @Override public boolean schemaReady(){return true;}
        };
        var service=new AnalyticsExploreService(new AnalyticsExploreRepository(jdbc),summaries,clock);
        var json=JsonMapper.builder().findAndAddModules().build();
        String botSnapshotPath=System.getenv("ANALYTICS_PREVIEW_BOT_SNAPSHOT");
        final OriginBotService bots;
        if(realSnapshot && botSnapshotPath!=null && !botSnapshotPath.isBlank()) {
            Path botFile=Path.of(botSnapshotPath);
            if(Files.size(botFile)>12_000_000)throw new IllegalArgumentException("Bot snapshot too large");
            var botData=json.readTree(Files.readString(botFile));
            Clock botClock=Clock.fixed(Instant.parse(botData.path("generatedAt").asText()),ZoneOffset.UTC);
            bots=new OriginBotService("memory-only",botClock) {
                @Override protected tools.jackson.databind.JsonNode loadExport(){return botData;}
                @Override public Report report(String range,String from,String to) {
                    Report result=super.report(range,from,to);
                    return new Report(result.status(),"실제 미니 PC 접근 로그의 읽기 전용 복사본입니다. 실시간 수집이 아니며 Cloudflare 차단 요청은 포함하지 않습니다.",
                            result.from(),result.to(),result.generatedAt(),result.startedAt(),true,result.rows());
                }
            };
        } else bots=new OriginBotService("",clock);
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",port),16);
        var executor=Executors.newFixedThreadPool(2);server.setExecutor(executor);
        Path assets=Path.of("src/main/resources/static").toAbsolutePath().normalize();
        server.createContext("/",exchange->{
            int status=200;String type="application/json; charset=utf-8";byte[] body;
            try {
                if(realSnapshot && !MessageDigest.isEqual(gatewayToken.getBytes(StandardCharsets.UTF_8),Objects.toString(exchange.getRequestHeaders().getFirst("X-Preview-Gateway"),"").getBytes(StandardCharsets.UTF_8)))
                    throw new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED,"Protected preview");
                if(!exchange.getRequestMethod().equals("GET"))throw new ResponseStatusException(org.springframework.http.HttpStatus.METHOD_NOT_ALLOWED);
                String path=exchange.getRequestURI().getPath();
                if(path.equals("/preview-auth")) body=json.writeValueAsBytes(Map.of("roles",List.of("ADMIN"),"nickname",realSnapshot?"실데이터 프리뷰":"합성 데이터 검증"));
                else if(path.equals("/api/admin/v1/service-analytics/explore")) {
                    Map<String,String> query=new HashMap<>();
                    String raw=exchange.getRequestURI().getRawQuery();
                    if(raw!=null)for(String entry:raw.split("&")){String[] parts=entry.split("=",2);query.put(URLDecoder.decode(parts[0],StandardCharsets.UTF_8),parts.length==2?URLDecoder.decode(parts[1],StandardCharsets.UTF_8):"");}
                    Map<String,String> filters=new HashMap<>();for(String key:List.of("device","source","channel","page","country"))if(query.containsKey(key))filters.put(key,query.get(key));
                    String exclude=query.getOrDefault("excludeBots","true");
                    if(!Set.of("true","false").contains(exclude)) throw new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST);
                    body=json.writeValueAsBytes(service.explore(query.getOrDefault("range","7d"),query.get("from"),query.get("to"),filters,Boolean.parseBoolean(exclude)));
                } else if(path.equals("/api/admin/v1/service-analytics/origin-bots")) {
                    Map<String,String> query=new HashMap<>();String raw=exchange.getRequestURI().getRawQuery();
                    if(raw!=null)for(String entry:raw.split("&")){String[] parts=entry.split("=",2);query.put(URLDecoder.decode(parts[0],StandardCharsets.UTF_8),parts.length==2?URLDecoder.decode(parts[1],StandardCharsets.UTF_8):"");}
                    body=json.writeValueAsBytes(bots.report(query.getOrDefault("range","7d"),query.get("from"),query.get("to")));
                }
                else if(path.equals("/api/admin/v1/service-analytics/realtime"))body=json.writeValueAsBytes(Map.of("available",true,"fetchedAt",clock.instant(),"data",summaries.realtime(clock.instant().minusSeconds(1800),!"excludeBots=false".equals(exchange.getRequestURI().getRawQuery()))));
                else {
                    String file=path.equals("/")?"service-analytics.html":path.substring(1);
                    if(!ASSETS.contains(file))throw new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND);
                    String content=Files.readString(assets.resolve(file));
                    String previewLabel=realSnapshot?"실제 이용 기록 · "+clock.instant().atZone(AnalyticsExploreQuery.SEOUL).format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))+" KST 기준 복사본 · 읽기 전용 · 실시간 갱신 아님":"검증 프리뷰 · 합성 데이터 · 실제 Java/SQL 집계 · 운영 데이터와 연결되지 않습니다.";
                    if(file.equals("service-analytics.html"))content=content.replace("<script src=\"/admin-session.js?v=2\"></script>","")
                            .replace("<body class=\"admin-page analytics-page\">","<body class=\"admin-page analytics-page\"><aside style=\"padding:12px 24px;background:#fff4d6;color:#624918;text-align:center\">"+previewLabel+"</aside>");
                    if(file.equals("service-analytics.js")){
                        content=content.replace("https://api.geupddong.com/api/v1/auth/me","/preview-auth");
                        if(realSnapshot)content=content.replace("지금 들어오는 방문","복사 시점 직전 30분").replace("최근 30분 · 전체 서비스 기준","복사 시점 직전 30분 · 전체 서비스 기준");
                    }
                    // Keep the existing shell's design without opening unrelated admin pages in the test.
                    if(file.equals("admin-shell.js"))content += "\ndocument.querySelectorAll('a').forEach(a=>{a.removeAttribute('href');a.setAttribute('aria-disabled','true')});";
                    body=content.getBytes(StandardCharsets.UTF_8);
                    type=file.endsWith(".css")?"text/css; charset=utf-8":file.endsWith(".js")?"application/javascript; charset=utf-8":"text/html; charset=utf-8";
                }
            }catch(ResponseStatusException error){status=error.getStatusCode().value();body=json.writeValueAsBytes(Map.of("status",status,"message",Objects.toString(error.getReason(),"Request rejected")));}
            catch(Exception error){status=500;body=json.writeValueAsBytes(Map.of("status",500,"message","Preview query failed"));}
            exchange.getResponseHeaders().set("Content-Type",type);
            exchange.getResponseHeaders().set("Cache-Control","no-store");
            exchange.getResponseHeaders().set("X-Robots-Tag","noindex, nofollow");
            exchange.getResponseHeaders().set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
            exchange.sendResponseHeaders(status,body.length);exchange.getResponseBody().write(body);exchange.close();
        });
        server.start();
        System.out.println((realSnapshot?"PROTECTED_SNAPSHOT_PREVIEW_READY":"SYNTHETIC_PREVIEW_READY")+" http://127.0.0.1:"+port+" (expires in "+ttl+" seconds; no operational database connection)");
        var expiry=Executors.newSingleThreadScheduledExecutor();
        Runnable stop=()->{server.stop(0);executor.shutdownNow();expiry.shutdownNow();jdbc.execute("SHUTDOWN");};
        expiry.schedule(stop,ttl,TimeUnit.SECONDS);
        Runtime.getRuntime().addShutdownHook(new Thread(()->{server.stop(0);executor.shutdownNow();expiry.shutdownNow();}));
    }
    private static void createSchema(JdbcTemplate jdbc) {
        jdbc.execute("""
            CREATE TABLE service_analytics_event(event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
             occurred_at TIMESTAMP,occurred_date DATE,event_name VARCHAR(40),page_key VARCHAR(120),channel_key VARCHAR(40),
             source_key VARCHAR(80),device_type VARCHAR(20),os_family VARCHAR(30),browser_family VARCHAR(30),country_code VARCHAR(2),
             city_name VARCHAR(80),visitor_hash BINARY(32),session_hash BINARY(32),engagement_seconds INTEGER,result_count_bucket VARCHAR(16),
             event_detail VARCHAR(40),success_status BOOLEAN,key_event BOOLEAN,traffic_class VARCHAR(16) NOT NULL DEFAULT 'LEGACY')
            """);
        jdbc.execute("CREATE INDEX idx_preview_date ON service_analytics_event(occurred_date,event_name)");
        jdbc.execute("CREATE TABLE service_analytics_daily_summary(analytics_date DATE,active_users BIGINT,new_users BIGINT,sessions BIGINT,views BIGINT,engaged_sessions BIGINT,key_events BIGINT,total_engagement_seconds BIGINT,calculated_at TIMESTAMP)");
        jdbc.execute("CREATE TABLE service_analytics_daily_dimension(analytics_date DATE,dimension_type VARCHAR(30),dimension_key VARCHAR(120),dimension_label VARCHAR(120),active_users BIGINT,views BIGINT,sessions BIGINT,event_count BIGINT,key_events BIGINT,engagement_seconds BIGINT)");
    }
    private static void seed(JdbcTemplate jdbc,Clock clock) {
        jdbc.update("INSERT INTO service_analytics_daily_summary VALUES(?,?,?,?,?,?,?,?,?)",java.sql.Date.valueOf(LocalDate.now(clock)),0,0,0,0,0,0,0,Timestamp.from(clock.instant()));
        var today=clock.instant().atZone(AnalyticsExploreQuery.SEOUL).toLocalDate();
        List<Object[]> batch=new ArrayList<>();
        for(int day=32;day>=0;day--)for(int i=0;i<24+(32-day)*2;i++) {
            LocalDate date=today.minusDays(day);Instant start=date.atTime(i%24,(i*7)%60).atZone(AnalyticsExploreQuery.SEOUL).toInstant();
            if(!start.plusSeconds(100).isBefore(clock.instant()))continue;
            String source=i%4==0?"naver":i%4==1?"google":"none",device=i%5==0?"desktop":"mobile",country=i%4==0?"JP":"KR";
            byte[] visitor=new byte[32],session=new byte[32];visitor[0]=(byte)(i%18);session[0]=(byte)day;session[1]=(byte)i;
            var names=new ArrayList<>(List.of("session_start","page_view","toilet_search","search_result_select","toilet_detail_open","directions_click","engagement"));
            if(i%3==0)names.addAll(List.of("report_start","report_submit"));
            if(i%4==0)names.addAll(List.of("screen_view","review_submit"));
            if(i%5==0)names.add("page_view");
            for(int n=0;n<names.size();n++){
                String name=names.get(n);Boolean success=name.endsWith("submit")?i%7!=0:null;
                String page=n>6?"/toilet/:id":i%11==0?"/other":"/";
                batch.add(new Object[]{Timestamp.from(start.plusSeconds(n*5L)),java.sql.Date.valueOf(date),name,page,source.equals("none")?"Direct":"Organic Search",source,device,device.equals("mobile")?"iOS":"Windows",device.equals("mobile")?"Safari":"Chrome",country,"검증 도시 "+(i%21+1),visitor,session,name.equals("engagement")?15+i%60:0,i%9==0?"0":"1-5",name.equals("screen_view")?"review_write":"",success,Set.of("search_result_select","report_start","report_submit","review_submit").contains(name)});
            }
        }
        jdbc.batchUpdate("INSERT INTO service_analytics_event(occurred_at,occurred_date,event_name,page_key,channel_key,source_key,device_type,os_family,browser_family,country_code,city_name,visitor_hash,session_hash,engagement_seconds,result_count_bucket,event_detail,success_status,key_event) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",batch);
        // Synthetic fixtures only; real historical snapshots remain LEGACY, never guessed.
        jdbc.update("UPDATE service_analytics_event SET traffic_class=CASE WHEN source_key='google' THEN 'BOT' ELSE 'UNFLAGGED' END");
    }
}
