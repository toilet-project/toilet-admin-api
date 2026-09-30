package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import tools.jackson.databind.ObjectMapper;

/** Loopback-only preview. Test source is never included in the production jar. */
public class ApiUsagePreviewServer {
    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8193;
        boolean demo = args.length > 1 && args[1].equals("demo");
        boolean gateway = args.length > 1 && args[1].equals("gateway");
        boolean live = gateway || args.length > 1 && args[1].equals("live");
        String gatewayToken = System.getenv().getOrDefault("PREVIEW_GATEWAY_TOKEN", "");
        if (gateway && !gatewayToken.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Gateway credential required");
        var mapper = new ObjectMapper();
        var clock = demo ? Clock.fixed(Instant.parse("2026-09-16T07:00:00Z"),ZoneOffset.UTC) : Clock.systemUTC();
        var reader = new UsageSnapshotReader(live ? System.getenv().getOrDefault("API_USAGE_SNAPSHOT_DIRECTORY", "") : "",mapper) {
            @Override public Snapshot read(String id) throws Exception {
                if (!demo) return super.read(id);
                Map<String,Counter> metrics = switch(id) {
                    case "google-maps" -> Map.of("maps-sdk",new Counter(18420,null));
                    case "google-places" -> Map.of("places-autocomplete",new Counter(8400,null),"places-details",new Counter(3200,null));
                    case "google-translation" -> Map.of("translation-characters",new Counter(680000,null));
                    default -> Map.of();
                };
                return metrics.isEmpty() ? null : new Snapshot("2026-09",clock.instant(),"화면 검증용 예시 수치","운영 데이터 아님",metrics);
            }
        };
        var google = new GoogleUsageClient(mapper,live ? System.getenv().getOrDefault("API_USAGE_GOOGLE_PROJECT_ID","") : "",
                live ? System.getenv().getOrDefault("API_USAGE_GOOGLE_CREDENTIALS_FILE","") : "","","","",
                live ? System.getenv().getOrDefault("API_USAGE_GOOGLE_CREDENTIALS_BASE64","") : "",
                live ? System.getenv().getOrDefault("API_USAGE_GOOGLE_TRANSLATION_PROJECT_ID","") : "");
        var naver = new NaverUsageClient(mapper,live ? System.getenv().getOrDefault("API_USAGE_NAVER_CREDENTIALS_FILE","") : "",
                live ? System.getenv().getOrDefault("API_USAGE_NAVER_CREDENTIALS_BASE64","") : "");
        var service = new ApiUsageService(new UsageCatalog(mapper),reader,google,naver,clock);
        Path historyPath=Path.of(System.getenv().getOrDefault("API_USAGE_PREVIEW_HISTORY_DIRECTORY","build/api-usage-preview-history"));
        UsageHistoryStore historyStore=new UsageHistoryStore() {
            public Snapshot find(String id,String month) throws Exception {
                Path file=historyPath.resolve(id+"-"+month+".json");
                return Files.exists(file) ? mapper.readValue(Files.readString(file),Snapshot.class) : null;
            }
            public void save(String id,Snapshot value) throws Exception {
                Files.createDirectories(historyPath);
                Path file=historyPath.resolve(id+"-"+value.month()+".json"), temp=Files.createTempFile(historyPath,"monthly-",".tmp");
                try {
                    Files.writeString(temp,mapper.writeValueAsString(new Snapshot(value.month(),value.asOf(),value.source(),value.scope(),value.metrics())));
                    Files.move(temp,file,StandardCopyOption.REPLACE_EXISTING);
                } finally { Files.deleteIfExists(temp); }
            }
        };
        var history=new UsageHistoryService(new UsageCatalog(mapper),reader,google,naver,historyStore,clock);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1",port),10);
        var executor = Executors.newFixedThreadPool(3); server.setExecutor(executor);
        Path assets = Path.of("src/main/resources/static").toAbsolutePath().normalize();
        Set<String> files = Set.of("api-usage.html","api-usage.js","api-usage-math.js","api-usage.css","dashboard.css","admin-shell.css","admin-shell.js","admin-session.css","brand.css","cloudflare.html","workspace-pages.js","brand/hangul-point-v1/favicon.svg","brand/hangul-point-v1/lockup-ko.svg");
        server.createContext("/",exchange -> {
            int status = 200; String type = "application/json; charset=utf-8"; byte[] body;
            try {
                if (gateway && !java.security.MessageDigest.isEqual(gatewayToken.getBytes(StandardCharsets.UTF_8),
                        Objects.toString(exchange.getRequestHeaders().getFirst("X-Preview-Gateway"), "").getBytes(StandardCharsets.UTF_8))) {
                    exchange.sendResponseHeaders(403,-1); exchange.close(); return;
                }
                if (!exchange.getRequestMethod().equals("GET")) throw new IllegalArgumentException();
                String path = exchange.getRequestURI().getPath();
                if (path.equals("/api/v1/auth/me")) body = mapper.writeValueAsBytes(Map.of("roles",List.of("ADMIN")));
                else if (path.equals("/api/admin/v1/api-usage")) {
                    tools.jackson.databind.node.ObjectNode report = mapper.valueToTree(service.report());
                    report.put("demo",demo);
                    body = mapper.writeValueAsBytes(report);
                }
                else if(path.equals("/api/admin/v1/api-usage/history")) {
                    String query=Objects.toString(exchange.getRequestURI().getRawQuery(),"");
                    String id=Arrays.stream(query.split("&")).filter(p->p.startsWith("service=")).findFirst().orElseThrow().substring(8);
                    body=mapper.writeValueAsBytes(history.history(URLDecoder.decode(id,StandardCharsets.UTF_8)));
                }
                else if (path.equals("/api/admin/v1/api-usage/estimate")) {
                    Map<String,String> params = new HashMap<>();
                    for(String pair:exchange.getRequestURI().getRawQuery().split("&")) {
                        var parts=pair.split("=",2); params.put(parts[0],URLDecoder.decode(parts[1],StandardCharsets.UTF_8));
                    }
                    body = mapper.writeValueAsBytes(service.estimate(params.get("metric"),Long.parseLong(params.get("quantity")),Boolean.parseBoolean(params.getOrDefault("includeFree","true"))));
                } else {
                    String file = path.equals("/") ? "api-usage.html" : path.substring(1);
                    if (!files.contains(file)) { status = 404; body = new byte[0]; }
                    else {
                        String text = Files.readString(assets.resolve(file));
                        if (file.endsWith(".html")) text = text.replace("<script src=\"/admin-session.js?v=2\"></script>","")
                                .replace("<body class=\"admin-page\">","<body class=\"admin-page\"><div style=\"padding:9px 16px;text-align:center;background:#fff2d4;color:#785723;font-size:12px\">미리보기 · " + (demo ? "예시 수치 · 운영 데이터 아님" : live ? "실제 사용량 · 읽기 전용 · 서비스별 집계 시각 확인" : "연결 전 상태") + "</div>");
                        if (file.endsWith(".js")) text = text.replace("https://api.geupddong.com","");
                        body = text.getBytes(StandardCharsets.UTF_8);
                        type = (file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/javascript") + "; charset=utf-8";
                    }
                }
            } catch (Exception ignored) { status = 400; body = "{}".getBytes(StandardCharsets.UTF_8); }
            exchange.getResponseHeaders().set("Content-Type",type);
            exchange.getResponseHeaders().set("Cache-Control","no-store");
            exchange.sendResponseHeaders(status,body.length);
            try(var out=exchange.getResponseBody()) { out.write(body); }
        });
        server.start(); System.out.println("API usage preview: http://127.0.0.1:"+port+"/api-usage.html");
        var collector=Executors.newSingleThreadScheduledExecutor();
        if(live) collector.scheduleWithFixedDelay(history::collectRecent,1,21600,TimeUnit.SECONDS);
        var stop = Executors.newSingleThreadScheduledExecutor();
        stop.schedule(() -> { server.stop(0); executor.shutdownNow(); collector.shutdownNow(); stop.shutdown(); },gateway ? 24 : 1,TimeUnit.HOURS);
    }
}
