package com.example.toiletadmin.operations.controller;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.toiletadmin.operations.dto.OperationsStatusResponse;
import com.example.toiletadmin.operations.service.OperationsStatusService;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(OperationsStatusController.class)
class OperationsStatusControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private OperationsStatusService operationsStatusService;

    @Test
    void returnsOperationalSummary() throws Exception {
        given(operationsStatusService.getStatus()).willReturn(new OperationsStatusResponse(
                new OperationsStatusResponse.ServiceStatus("UP", "관리자 정상"),
                new OperationsStatusResponse.ServiceStatus("UP", "DB 정상"),
                new OperationsStatusResponse.ServiceStatus("UP", "API 정상"),
                new OperationsStatusResponse.BatchStatus("UP", LocalDateTime.of(2026, 8, 31, 2, 0), "배치 정상"),
                new OperationsStatusResponse.DiskStatus("UP", 80, 100, 20),
                LocalDateTime.of(2026, 8, 31, 9, 0)
        ));

        mockMvc.perform(get("/api/admin/v1/operations/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.database.status").value("UP"))
                .andExpect(jsonPath("$.batch.status").value("UP"))
                .andExpect(jsonPath("$.disk.usedPercent").value(20));
    }
}
