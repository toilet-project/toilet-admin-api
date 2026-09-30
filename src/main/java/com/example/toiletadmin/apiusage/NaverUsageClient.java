package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.*;

/** Official Billing read API; legacy AI NAVER and API HUB are deliberately excluded. */
@Component
public class NaverUsageClient {
    private static final Map<String,String> TYPES = Map.of("MPDNM_MAPS","naver-map","MPGEO_MAPS","naver-geocoding");
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter PROVIDER_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssZ");
    private final ObjectMapper mapper;
    private final String file, encoded;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    public NaverUsageClient(ObjectMapper mapper,
            @Value("${api-usage.naver.credentials-file:}") String file,
            @Value("${api-usage.naver.credentials-base64:}") String encoded) {
        this.mapper=mapper; this.file=file; this.encoded=encoded;
    }
    public Snapshot read(UsageModels.Service service, Instant start, Instant now) throws Exception {
        return readThrough(service,start,now,now);
    }
    public Snapshot readMonth(UsageModels.Service service, Instant start, Instant end) throws Exception {
        return readThrough(service,start,end,end.minusSeconds(1));
    }
    private Snapshot readThrough(UsageModels.Service service, Instant start, Instant now, Instant queryEnd) throws Exception {
        if (!service.id().equals("naver") || file.isBlank() && encoded.isBlank()) return null;
        JsonNode credentials;
        if (!file.isBlank()) {
            if (Files.size(Path.of(file)) > 65536) throw new IllegalArgumentException("Credential size");
            credentials=mapper.readTree(Files.readString(Path.of(file)));
        } else {
            if (encoded.length()>90000) throw new IllegalArgumentException("Credential size");
            credentials=mapper.readTree(Base64.getDecoder().decode(encoded));
        }
        String from=start.atZone(SEOUL).toLocalDate().format(DateTimeFormatter.BASIC_ISO_DATE);
        String to=queryEnd.atZone(SEOUL).toLocalDate().format(DateTimeFormatter.BASIC_ISO_DATE);
        var records=new ArrayList<JsonNode>();
        for(int page=1;page<=20;page++) {
            String path="/billing/v1/cost/getContractUsageListByDaily?useStartDay="+from+"&useEndDay="+to
                    +"&responseFormatType=json&pageSize=1000&pageNo="+page;
            String timestamp=Long.toString(System.currentTimeMillis());
            String access=credentials.path("accessKey").asText(), secret=credentials.path("secretKey").asText();
            if(access.isBlank() || secret.isBlank()) throw new IllegalArgumentException("Credential format");
            String signature=sign(path,timestamp,access,secret);
            var request=HttpRequest.newBuilder(URI.create("https://billingapi.apigw.ntruss.com"+path))
                    .timeout(Duration.ofSeconds(15)).header("x-ncp-apigw-timestamp",timestamp)
                    .header("x-ncp-iam-access-key",access).header("x-ncp-apigw-signature-v2",signature).GET().build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()!=200 || response.body().length()>4_000_000) throw new IllegalStateException("Naver read failed");
            JsonNode root=mapper.readTree(response.body()).path("getContractUsageListByDailyResponse");
            if(!root.path("returnCode").asText().equals("0")) throw new IllegalStateException("Naver read failed");
            for(var row:root.path("contractUsageListByDaily")) records.add(row);
            if(root.path("totalRows").asLong(-1)==records.size()) return parse(records,start,now);
            if(root.path("contractUsageListByDaily").isEmpty()) break;
        }
        throw new IllegalStateException("Incomplete Naver response");
    }
    static String sign(String path,String timestamp,String access,String secret) throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal(("GET "+path+"\n"+timestamp+"\n"+access).getBytes(StandardCharsets.UTF_8)));
    }
    static Snapshot parse(List<JsonNode> records,Instant start,Instant now) {
        record Row(String series,String metric,Instant end,long count) {}
        var rows=new ArrayList<Row>(); var seen=new HashSet<String>(); var cutoffs=new HashMap<String,Instant>();
        for(var record:records) {
            if(!record.path("contract").path("contractType").path("code").asText().equals("MAPS")) continue;
            var usage=record.path("usage");
            String type=usage.path("meteringType").path("code").asText();
            String metric=TYPES.get(type);
            if(metric==null) throw new IllegalArgumentException("Unmapped Maps product");
            if(!usage.path("unit").path("code").asText().equals("REQ_CNT")) throw new IllegalArgumentException("Unknown unit");
            Instant rowStart=OffsetDateTime.parse(record.path("useDate").path("useStartDate").asText(),PROVIDER_TIME).toInstant();
            Instant end=OffsetDateTime.parse(record.path("useDate").path("useEndDate").asText(),PROVIDER_TIME).toInstant().plusSeconds(1);
            if(rowStart.isBefore(start) || end.isAfter(now) || !rowStart.plusSeconds(86400).equals(end)) throw new IllegalArgumentException("Incomplete day");
            if(!usage.path("usageQuantity").isNumber()) throw new IllegalArgumentException("Missing usage");
            long count=usage.path("usageQuantity").decimalValue().longValueExact();
            if(count<0 || count>UsagePricing.MAX_QUANTITY) throw new IllegalArgumentException("Invalid usage");
            String contract=record.path("contract").path("contractNo").asText();
            String product=record.path("contractProduct").path("contractProductSequence").asText();
            if(contract.isBlank() || product.isBlank()) throw new IllegalArgumentException("Missing contract");
            String series=contract+":"+product+":"+type;
            if(!seen.add(series+":"+end)) throw new IllegalArgumentException("Duplicate daily record");
            cutoffs.merge(series,end,(a,b)->a.isAfter(b)?a:b);
            rows.add(new Row(series,metric,end,count));
        }
        if(rows.isEmpty()) throw new NoUsageData();
        // Compare every application at the same complete reporting cutoff.
        Instant asOf=Collections.min(cutoffs.values());
        var totals=new LinkedHashMap<String,Counter>();
        for(var row:rows) if(!row.end().isAfter(asOf)) totals.merge(row.metric(),new Counter(row.count(),null),
                (a,b)->new Counter(Math.addExact(a.used(),b.used()),null));
        return new Snapshot(YearMonth.from(start.atZone(SEOUL)).toString(),asOf,
                "NAVER Cloud Billing · 일별 공식 사용량 (반영 지연 있음)",
                "Maps 상품의 운영·테스트 앱 합계 · 기존 AI·NAVER API 및 NAVER API HUB 제외",totals);
    }
    public static final class NoUsageData extends RuntimeException {}
}
