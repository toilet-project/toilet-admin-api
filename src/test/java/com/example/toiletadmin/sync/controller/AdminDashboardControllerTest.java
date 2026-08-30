package com.example.toiletadmin.sync.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.toiletadmin.sync.dto.AdminDashboardResponse;
import com.example.toiletadmin.sync.service.BatchSyncHistoryService;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AdminDashboardController.class)
class AdminDashboardControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private BatchSyncHistoryService batchSyncHistoryService;

    @Test
    void returnsMonitoringSummaryForTheRequestedRange() throws Exception {
        LocalDate from = LocalDate.of(2026, 8, 1);
        LocalDate to = LocalDate.of(2026, 8, 30);
        when(batchSyncHistoryService.getDashboard(from, to)).thenReturn(new AdminDashboardResponse(
                from, to,
                new AdminDashboardResponse.BatchSummary(4, 1, 100, 20, 80, 0, 0, 53_554L, null, null),
                new AdminDashboardResponse.ReportSummary(false, null, null, null), List.of(), List.of()
        ));

        mockMvc.perform(get("/api/admin/v1/dashboard").param("from", "2026-08-01").param("to", "2026-08-30"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.batch.totalToiletCount").value(53554))
                .andExpect(jsonPath("$.reports.available").value(false));

        verify(batchSyncHistoryService).getDashboard(from, to);
    }
}
