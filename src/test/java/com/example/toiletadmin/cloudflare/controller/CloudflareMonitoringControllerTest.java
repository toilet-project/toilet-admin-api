package com.example.toiletadmin.cloudflare.controller;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.example.toiletadmin.cloudflare.dto.CloudflareMonitoringResponse;
import com.example.toiletadmin.cloudflare.dto.CloudflareMonitoringResponse.Section;
import com.example.toiletadmin.cloudflare.service.CloudflareMonitoringService;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(CloudflareMonitoringController.class)
class CloudflareMonitoringControllerTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private CloudflareMonitoringService service;

    @Test void returnsOnlyTheRequestedSectionAndDoesNotPermitHttpCaching() throws Exception {
        var at=Instant.parse("2026-09-30T06:00:00Z");
        given(service.getSection("traffic")).willReturn(new CloudflareMonitoringResponse("UNAVAILABLE",at,at.minusSeconds(86400),at,
                Map.of("traffic",new Section<>("UNAVAILABLE","조회 권한 확인 필요",null))));
        mvc.perform(get("/api/admin/v1/cloudflare/monitoring/traffic"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
                .andExpect(jsonPath("$.sections.traffic.status").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.sections.r2").doesNotExist());
    }
    @Test void rejectsUnknownSourceWithoutExposingAnError() throws Exception {
        given(service.getSection("unknown")).willThrow(new IllegalArgumentException("private error"));
        mvc.perform(get("/api/admin/v1/cloudflare/monitoring/unknown"))
                .andExpect(status().isBadRequest()).andExpect(content().string(""));
    }
}
