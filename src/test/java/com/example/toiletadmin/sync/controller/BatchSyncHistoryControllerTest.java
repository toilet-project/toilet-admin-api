package com.example.toiletadmin.sync.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.toiletadmin.sync.dto.BatchSyncDailySummaryResponse;
import com.example.toiletadmin.sync.dto.BatchSyncHistoryResponse;
import com.example.toiletadmin.sync.model.BatchSyncStatus;
import com.example.toiletadmin.sync.service.BatchSyncHistoryService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(BatchSyncHistoryController.class)
class BatchSyncHistoryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private BatchSyncHistoryService batchSyncHistoryService;

    @Test
    void returnsDailyAggregationForTheRequestedRange() throws Exception {
        when(batchSyncHistoryService.getDailySummaries(LocalDate.of(2026, 8, 26), LocalDate.of(2026, 8, 29)))
                .thenReturn(List.of(new BatchSyncDailySummaryResponse(
                        LocalDate.of(2026, 8, 29), 1, 0, 103, 22, 81, 0, 0, 12_345L
                )));

        mockMvc.perform(get("/api/admin/v1/batch-syncs/daily")
                        .param("from", "2026-08-26")
                        .param("to", "2026-08-29"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].insertedRecords").value(22))
                .andExpect(jsonPath("$[0].totalToiletCount").value(12345));

        verify(batchSyncHistoryService).getDailySummaries(LocalDate.of(2026, 8, 26), LocalDate.of(2026, 8, 29));
    }

    @Test
    void returnsExecutionHistoryWithFailureReasonOnlyForAdministrators() throws Exception {
        when(batchSyncHistoryService.getExecutions(null, null)).thenReturn(List.of(new BatchSyncHistoryResponse(
                1L, "SCHEDULED", BatchSyncStatus.FAILED,
                LocalDateTime.of(2026, 8, 29, 0, 0), LocalDateTime.of(2026, 8, 29, 0, 0),
                0, 0, 0, 0, 0, 0, null,
                LocalDateTime.of(2026, 8, 29, 2, 0), LocalDateTime.of(2026, 8, 29, 2, 0),
                "공공데이터 API 호출 실패"
        )));

        mockMvc.perform(get("/api/admin/v1/batch-syncs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].status").value("FAILED"))
                .andExpect(jsonPath("$[0].errorMessage").value("공공데이터 API 호출 실패"));
    }
}
