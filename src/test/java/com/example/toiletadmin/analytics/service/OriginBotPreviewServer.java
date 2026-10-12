package com.example.toiletadmin.analytics.service;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.web.server.ResponseStatusException;

/** Test classpath only: actual admin reader/rendering over a private aggregate snapshot. */
public final class OriginBotPreviewServer {
    private static final String HTML = """
        <!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>봇 이름 소급 분류 검토 · 급똥</title><link rel="stylesheet" href="/dashboard.css">
        <link rel="stylesheet" href="/service-analytics.css"></head><body class="analytics-page">
        <main class="dashboard-shell analytics-shell" style="margin:24px auto;padding:24px">
        <h1>봇 이름 소급 분류 검토</h1><p>실제 운영 로그의 재분류 사본 · 읽기 전용 · 운영 미반영</p>
        <p>전체 요청 수와 오류 건수를 유지하면서, 로그와 정확히 일치하는 Other bot 기록을 AhrefsBot으로 구분했습니다.
        공식 IP 인증을 소급한 결과는 아닙니다. 남은 Other bot은 이름을 확정하지 않은 기록입니다.</p>
        <section class="analytics-controls"><label>조회 기간 <select id="preview-range">
        <option value="7d">최근 7일</option><option value="today">오늘</option><option value="yesterday">어제</option>
        <option value="30d">최근 30일</option></select></label></section><section id="analytics-view"></section>
        </main><script src="/origin-bots.js"></script><script src="/service-analytics.js"></script></body></html>
        """;
    private static final String SCRIPT = """
        const range = document.getElementById('preview-range');
        const show = () => window.OriginBotAnalytics.show(document.getElementById('analytics-view'), {range:range.value});
        range.addEventListener('change',show); show();
        """;

    public static void main(String[] args) throws Exception {
        String token = System.getenv("PREVIEW_GATEWAY_TOKEN");
        if (token == null || !token.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Protected gateway token required");
        Path snapshot = Path.of(Objects.requireNonNull(System.getenv("ANALYTICS_PREVIEW_BOT_SNAPSHOT")));
        if (Files.size(snapshot) > 12_000_000) throw new IllegalArgumentException("Snapshot too large");
        var mapper = JsonMapper.builder().build();
        var data = mapper.readTree(Files.readAllBytes(snapshot));
        Clock clock = Clock.fixed(Instant.parse(data.path("generatedAt").asText()), ZoneOffset.UTC);
        var bots = new OriginBotService("snapshot-only", clock) {
            @Override protected tools.jackson.databind.JsonNode loadExport() { return data; }
        };
        if (!bots.report("7d", null, null).status().equals("OK")) throw new IllegalArgumentException("Invalid aggregate snapshot");
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8196;
        int ttl = args.length > 1 ? Math.min(7200, Integer.parseInt(args[1])) : 7200;
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
        var pool = Executors.newFixedThreadPool(2); server.setExecutor(pool);
        Path assets = Path.of("src/main/resources/static");
        server.createContext("/", exchange -> {
            int status = 200; String type = "application/json; charset=utf-8"; byte[] body;
            try {
                if (!MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                        Objects.toString(exchange.getRequestHeaders().getFirst("X-Preview-Gateway"), "").getBytes(StandardCharsets.UTF_8)))
                    throw new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED);
                if (!exchange.getRequestMethod().equals("GET")) throw new ResponseStatusException(org.springframework.http.HttpStatus.METHOD_NOT_ALLOWED);
                String path = exchange.getRequestURI().getPath();
                if (path.equals("/api/admin/v1/service-analytics/origin-bots")) {
                    Map<String,String> query = new HashMap<>();
                    String raw = exchange.getRequestURI().getRawQuery();
                    if (raw != null) for (String item : raw.split("&")) {
                        String[] pair = item.split("=", 2);
                        query.put(URLDecoder.decode(pair[0], StandardCharsets.UTF_8), pair.length > 1 ? URLDecoder.decode(pair[1], StandardCharsets.UTF_8) : "");
                    }
                    var report = bots.report(query.getOrDefault("range", "7d"), query.get("from"), query.get("to"));
                    body = mapper.writeValueAsBytes(new OriginBotService.Report(report.status(),
                            "실제 운영 로그의 재분류 사본입니다. 운영 미반영·실시간 갱신 아님·Cloudflare에서 끝난 요청 제외.",
                            report.from(), report.to(), report.generatedAt(), report.startedAt(), report.partial(), report.rows()));
                } else if (path.equals("/service-analytics.html") || path.equals("/")) {
                    body = HTML.getBytes(StandardCharsets.UTF_8); type = "text/html; charset=utf-8";
                } else if (path.equals("/service-analytics.js")) {
                    body = SCRIPT.getBytes(StandardCharsets.UTF_8); type = "application/javascript; charset=utf-8";
                } else if (Set.of("/origin-bots.js", "/dashboard.css", "/service-analytics.css").contains(path)) {
                    body = Files.readAllBytes(assets.resolve(path.substring(1)));
                    type = path.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/css; charset=utf-8";
                } else throw new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND);
            } catch (ResponseStatusException error) {
                status = error.getStatusCode().value(); body = mapper.writeValueAsBytes(Map.of("status", status));
            } catch (Exception error) { status = 500; body = mapper.writeValueAsBytes(Map.of("status", status)); }
            exchange.getResponseHeaders().set("Content-Type", type);
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
            exchange.getResponseHeaders().set("X-Robots-Tag", "noindex, nofollow");
            exchange.sendResponseHeaders(status, body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        server.start(); System.out.println("PROTECTED_BOT_SNAPSHOT_READY http://127.0.0.1:" + port);
        var expiry = Executors.newSingleThreadScheduledExecutor();
        expiry.schedule(() -> { server.stop(0); pool.shutdownNow(); expiry.shutdownNow(); }, ttl, TimeUnit.SECONDS);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { server.stop(0); pool.shutdownNow(); expiry.shutdownNow(); }));
    }
}
