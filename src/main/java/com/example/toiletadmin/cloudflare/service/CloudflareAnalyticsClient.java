package com.example.toiletadmin.cloudflare.service;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;

@Component
public class CloudflareAnalyticsClient {

    private static final String QUERY = """
            query AdminUsage($accountTag: string!, $periodStart: Time!, $now: Time!, $dateStart: Date!, $dateEnd: Date!, $storageStart: Time!) {
              viewer {
                accounts(filter: {accountTag: $accountTag}) {
                  workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $periodStart, datetime_leq: $now}) {
                    sum { requests }
                  }
                  d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $dateStart, date_leq: $dateEnd}) {
                    sum { rowsRead }
                  }
                  r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: $storageStart, datetime_leq: $now}, orderBy: [datetime_DESC]) {
                    dimensions { bucketName datetime }
                    max { payloadSize metadataSize }
                  }
                }
              }
            }
            """;

    private final RestClient restClient;
    private final String accountId;
    private final String apiToken;

    public CloudflareAnalyticsClient(
            @Value("${cloudflare.analytics.endpoint:https://api.cloudflare.com/client/v4/graphql}") String endpoint,
            @Value("${cloudflare.analytics.account-id:}") String accountId,
            @Value("${cloudflare.analytics.api-token:}") String apiToken
    ) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(java.time.Duration.ofSeconds(3));
        requestFactory.setReadTimeout(java.time.Duration.ofSeconds(8));
        this.restClient = RestClient.builder().baseUrl(endpoint).requestFactory(requestFactory).build();
        this.accountId = accountId == null ? "" : accountId.trim();
        this.apiToken = apiToken == null ? "" : apiToken.trim();
    }

    public boolean isConfigured() {
        return !accountId.isBlank() && !apiToken.isBlank();
    }

    public JsonNode query(Instant periodStart, Instant now, LocalDate periodStartDate, LocalDate currentDate, Instant storageStart) {
        return restClient.post()
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiToken)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of(
                        "query", QUERY,
                        "variables", Map.of(
                                "accountTag", accountId,
                                "periodStart", periodStart.toString(),
                                "now", now.toString(),
                                "dateStart", periodStartDate.toString(),
                                "dateEnd", currentDate.toString(),
                                "storageStart", storageStart.toString()
                        )
                ))
                .retrieve()
                .body(JsonNode.class);
    }
}
