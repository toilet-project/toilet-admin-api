package com.example.toiletadmin.cloudflare.controller;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse;
import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse.UsageMetric;
import com.example.toiletadmin.cloudflare.service.CloudflareUsageService;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(CloudflareUsageController.class)
class CloudflareUsageControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CloudflareUsageService cloudflareUsageService;

    @Test
    void returnsUsageMetricsWithoutExposingCredentials() throws Exception {
        Instant checkedAt = Instant.parse("2026-09-13T01:30:00Z");
        given(cloudflareUsageService.getUsage()).willReturn(new CloudflareUsageResponse(
                true, "UP", checkedAt, Instant.parse("2026-09-14T00:00:00Z"),
                "https://dash.cloudflare.com/",
                UsageMetric.of(18_420, 100_000, "requests"),
                UsageMetric.of(620_000, 5_000_000, "rows"),
                UsageMetric.of(800_000_000, 10_737_418_240L, "bytes"),
                "정상"
        ));

        mockMvc.perform(get("/api/admin/v1/cloudflare/usage"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true))
                .andExpect(jsonPath("$.workersRequests.used").value(18420))
                .andExpect(jsonPath("$.d1RowsRead.limit").value(5000000))
                .andExpect(jsonPath("$.r2StorageBytes.unit").value("bytes"));
    }
}
