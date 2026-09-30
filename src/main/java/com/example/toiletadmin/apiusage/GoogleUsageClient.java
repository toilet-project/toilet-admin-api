package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.*;

/** Read-only Monitoring adapter. Credentials never leave this server except a signed OAuth assertion. */
@Component
public class GoogleUsageClient {
    private static final String MAPS_REQUESTS = "metric.type=\"maps.googleapis.com/service/v2/request_count\" AND resource.type=\"maps.googleapis.com/Api\"";
    // Native SDK traffic is reported under Consumed API, unlike Places' Maps v2 metrics.
    public static final String DEFAULT_MAPS_FILTER = "metric.type=\"serviceruntime.googleapis.com/api/request_count\" AND resource.type=\"consumed_api\" AND (resource.labels.service=\"maps-android-backend.googleapis.com\" OR resource.labels.service=\"maps-ios-backend.googleapis.com\")";
    public static final String DEFAULT_AUTOCOMPLETE_FILTER = MAPS_REQUESTS + " AND resource.labels.service=\"places.googleapis.com\" AND resource.labels.method=\"google.maps.places.v1.Places.AutocompletePlaces\"";
    public static final String DEFAULT_DETAILS_FILTER = MAPS_REQUESTS + " AND resource.labels.service=\"places.googleapis.com\" AND resource.labels.method=\"google.maps.places.v1.Places.GetPlace\"";
    private final ObjectMapper mapper;
    private final String project;
    private final String translationProject;
    private final String credentialFile;
    private final String credentialBase64;
    private final Map<String, String> filters;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private String token;
    private Instant tokenExpires = Instant.EPOCH;

    public GoogleUsageClient(ObjectMapper mapper,
            @Value("${api-usage.google.project-id:}") String project,
            @Value("${api-usage.google.credentials-file:}") String credentialFile,
            @Value("${api-usage.google.maps-filter:}") String mapsFilter,
            @Value("${api-usage.google.autocomplete-filter:}") String autocompleteFilter,
            @Value("${api-usage.google.details-filter:}") String detailsFilter,
            @Value("${api-usage.google.credentials-base64:}") String credentialBase64,
            @Value("${api-usage.google.translation-project-id:}") String translationProject) {
        this.mapper = mapper; this.project = project; this.credentialFile = credentialFile;
        this.credentialBase64 = credentialBase64;
        this.translationProject = translationProject;
        filters = Map.of("maps-sdk", mapsFilter.isBlank() ? DEFAULT_MAPS_FILTER : mapsFilter,
                "places-autocomplete", autocompleteFilter.isBlank() ? DEFAULT_AUTOCOMPLETE_FILTER : autocompleteFilter,
                "places-details", detailsFilter.isBlank() ? DEFAULT_DETAILS_FILTER : detailsFilter,
                "translation-characters", "metric.type=\"serviceruntime.googleapis.com/quota/rate/net_usage\" AND resource.type=\"consumer_quota\" AND resource.labels.service=\"translate.googleapis.com\" AND metric.labels.quota_metric=\"translate.googleapis.com/default\"");
    }
    public Snapshot read(UsageModels.Service service, Instant start, Instant now) throws Exception {
        return readThrough(service, start, now.minusSeconds(300).truncatedTo(java.time.temporal.ChronoUnit.HOURS));
    }
    public Snapshot readMonth(UsageModels.Service service, Instant start, Instant end, Instant now) throws Exception {
        // These metric families retain six weeks. Never present a truncated old month as a full total.
        if (start.isBefore(now.minus(Duration.ofDays(42)))) return null;
        return readThrough(service, start, end);
    }
    private Snapshot readThrough(UsageModels.Service service, Instant start, Instant asOf) throws Exception {
        boolean translation = service.id().equals("google-translation");
        String selectedProject = translation ? translationProject : project;
        if (selectedProject.isBlank() || (credentialFile.isBlank() && credentialBase64.isBlank())
                || !Set.of("google-maps", "google-places", "google-translation").contains(service.id())) return null;
        if (!selectedProject.matches("[a-z][a-z0-9-]{4,61}[a-z0-9]")) throw new IllegalArgumentException("Invalid project");
        if (service.metrics().stream().allMatch(m -> filters.getOrDefault(m.id(), "").isBlank())) return null;
        // Provider samples can arrive up to five minutes late. Keep complete hourly buckets only.
        if (!asOf.isAfter(start)) throw new NoUsageData();
        Map<String, Counter> counters = new LinkedHashMap<>();
        for (var metric : service.metrics()) {
            String filter = filters.getOrDefault(metric.id(), "");
            if (filter.isBlank()) continue;
            Long total = query(selectedProject, filter, start, asOf);
            if (total != null) counters.put(metric.id(), new Counter(total, null));
        }
        if (counters.isEmpty()) throw new NoUsageData();
        return new Snapshot(YearMonth.from(start.atZone(ZoneId.of(service.timeZone()))).toString(), asOf,
                translation ? "Google Cloud Monitoring · NMT 문자 쿼터 집계" : "Google Cloud Monitoring · 요청 집계",
                "프로젝트 " + selectedProject + (translation ? " · NMT 입력 문자만 집계 · LLM 입출력 문자 미집계 · 청구 확정 수치 아님" : " · 청구 계정 전체 합계 아님"), counters);
    }
    protected Long query(String selectedProject, String filter, Instant start, Instant end) throws Exception {
        String next = "";
        Long sum = null;
        for (int page = 0; page < 20; page++) {
            String query = "filter=" + encode(filter) + "&interval.startTime=" + encode(start.toString())
                    + "&interval.endTime=" + encode(end.toString())
                    + "&aggregation.alignmentPeriod=3600s&aggregation.perSeriesAligner=ALIGN_SUM"
                    + "&aggregation.crossSeriesReducer=REDUCE_SUM&view=FULL&pageSize=1000"
                    + (next.isBlank() ? "" : "&pageToken=" + encode(next));
            var request = HttpRequest.newBuilder(URI.create("https://monitoring.googleapis.com/v3/projects/" + selectedProject + "/timeSeries?" + query))
                    .timeout(Duration.ofSeconds(12)).header("Authorization", "Bearer " + accessToken()).GET().build();
            JsonNode body = send(request);
            if (body.path("executionErrors").size() > 0) throw new IllegalStateException("Partial monitoring response");
            Long count = count(body, start, end);
            if (count != null) sum = Math.addExact(sum == null ? 0 : sum, count);
            next = body.path("nextPageToken").asText("");
            if (next.isBlank()) return sum;
        }
        throw new IllegalStateException("Incomplete monitoring response");
    }
    static Long count(JsonNode body, Instant start, Instant end) {
        Long sum = null;
        for (var series : body.path("timeSeries")) for (var point : series.path("points")) {
            Instant pointStart = Instant.parse(point.path("interval").path("startTime").asText());
            Instant pointEnd = Instant.parse(point.path("interval").path("endTime").asText());
            if (pointStart.isBefore(start) || pointEnd.isAfter(end)) throw new IllegalArgumentException("Partial interval");
            String raw = point.path("value").path("int64Value").asText();
            long value = Long.parseLong(raw);
            if (value < 0) throw new IllegalArgumentException("Negative metric");
            sum = Math.addExact(sum == null ? 0 : sum, value);
        }
        return sum;
    }
    private synchronized String accessToken() throws Exception {
        Instant now = Instant.now();
        if (token != null && now.isBefore(tokenExpires)) return token;
        JsonNode credentials;
        if (!credentialFile.isBlank()) {
            Path path = Path.of(credentialFile);
            if (Files.size(path) > 65536) throw new IllegalArgumentException("Invalid credential file");
            credentials = mapper.readTree(Files.readString(path));
        } else {
            if (credentialBase64.length() > 90000) throw new IllegalArgumentException("Invalid credential size");
            credentials = mapper.readTree(Base64.getDecoder().decode(credentialBase64));
        }
        if (!credentials.path("type").asText().equals("service_account")) throw new IllegalArgumentException("Unsupported credential type");
        String header = base64(mapper.writeValueAsBytes(Map.of("alg", "RS256", "typ", "JWT")));
        String payload = base64(mapper.writeValueAsBytes(Map.of("iss", credentials.path("client_email").asText(),
                "scope", "https://www.googleapis.com/auth/monitoring.read", "aud", "https://oauth2.googleapis.com/token",
                "iat", now.getEpochSecond(), "exp", now.plusSeconds(3600).getEpochSecond())));
        String unsigned = header + "." + payload;
        String pem = credentials.path("private_key").asText().replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", "");
        var key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
        Signature signer = Signature.getInstance("SHA256withRSA"); signer.initSign(key);
        signer.update(unsigned.getBytes(StandardCharsets.UTF_8));
        String assertion = unsigned + "." + base64(signer.sign());
        var request = HttpRequest.newBuilder(URI.create("https://oauth2.googleapis.com/token"))
                .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=" + encode("urn:ietf:params:oauth:grant-type:jwt-bearer")
                        + "&assertion=" + encode(assertion))).build();
        JsonNode response = send(request);
        token = response.path("access_token").asText();
        if (token.isBlank()) throw new IllegalStateException("OAuth unavailable");
        tokenExpires = now.plusSeconds(Math.max(1, response.path("expires_in").asLong(3600) - 120));
        return token;
    }
    private JsonNode send(HttpRequest request) throws Exception {
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IllegalStateException("Google read failed");
        if (response.body().length() > 4_000_000) throw new IllegalStateException("Response too large");
        return mapper.readTree(response.body());
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static String base64(byte[] value) { return Base64.getUrlEncoder().withoutPadding().encodeToString(value); }
    public static final class NoUsageData extends RuntimeException {}
}
