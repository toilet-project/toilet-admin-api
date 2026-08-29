package com.example.toiletadmin.sync.dto;

import java.time.LocalDate;

public record BatchSyncDailySummaryResponse(
        LocalDate date,
        int successfulRuns,
        int failedRuns,
        int receivedRecords,
        int insertedRecords,
        int updatedRecords,
        int skippedRecords,
        int failedRecords,
        Long totalToiletCount
) {
}
