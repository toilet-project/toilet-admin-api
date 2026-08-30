package com.example.toiletadmin.sync.controller;

import com.example.toiletadmin.sync.dto.AdminDashboardResponse;
import com.example.toiletadmin.sync.service.BatchSyncHistoryService;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/admin/v1/dashboard")
public class AdminDashboardController {

    private final BatchSyncHistoryService batchSyncHistoryService;

    @GetMapping
    public AdminDashboardResponse getDashboard(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        return batchSyncHistoryService.getDashboard(from, to);
    }
}
