package com.example.toiletadmin.sync.controller;

import com.example.toiletadmin.sync.dto.BatchSyncDailySummaryResponse;
import com.example.toiletadmin.sync.dto.BatchSyncHistoryResponse;
import com.example.toiletadmin.sync.service.BatchSyncHistoryService;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/admin/v1/batch-syncs")
public class BatchSyncHistoryController {

    private final BatchSyncHistoryService batchSyncHistoryService;

    @GetMapping
    public List<BatchSyncHistoryResponse> getExecutions(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        return batchSyncHistoryService.getExecutions(from, to);
    }

    @GetMapping("/daily")
    public List<BatchSyncDailySummaryResponse> getDailySummaries(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        return batchSyncHistoryService.getDailySummaries(from, to);
    }
}
