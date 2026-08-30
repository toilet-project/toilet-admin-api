package com.example.toiletadmin.sync.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** 관리자 모니터링 화면의 첫 진입에 필요한 요약 데이터다. */
public record AdminDashboardResponse(
        LocalDate from,
        LocalDate to,
        BatchSummary batch,
        ReportSummary reports,
        List<BatchSyncDailySummaryResponse> dailySummaries,
        List<BatchSyncHistoryResponse> recentExecutions
) {
    public record BatchSummary(
            int successfulRuns,
            int failedRuns,
            int receivedRecords,
            int insertedRecords,
            int updatedRecords,
            int skippedRecords,
            int failedRecords,
            Long totalToiletCount,
            LocalDateTime lastSuccessAt,
            Long lastSuccessDurationSeconds
    ) { }

    /** 제보 테이블 도입 전에는 수치를 0으로 오인하지 않도록 available을 명시한다. */
    public record ReportSummary(boolean available, Integer pending, Integer approved, Integer rejected) { }
}
