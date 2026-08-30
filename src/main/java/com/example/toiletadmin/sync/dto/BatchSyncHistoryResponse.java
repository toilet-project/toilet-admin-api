package com.example.toiletadmin.sync.dto;

import com.example.toiletadmin.sync.model.BatchSyncHistory;
import com.example.toiletadmin.sync.model.BatchSyncStatus;
import java.time.LocalDateTime;

public record BatchSyncHistoryResponse(
        Long id,
        String triggerType,
        BatchSyncStatus status,
        LocalDateTime rangeFrom,
        LocalDateTime rangeTo,
        int requestedPages,
        int receivedRecords,
        int insertedRecords,
        int updatedRecords,
        int skippedRecords,
        int failedRecords,
        Long totalToiletCount,
        LocalDateTime startedAt,
        LocalDateTime completedAt,
        String errorMessage
) {
    public static BatchSyncHistoryResponse from(BatchSyncHistory history) {
        return new BatchSyncHistoryResponse(
                history.getId(), history.getTriggerType(), history.getStatus(), history.getRangeFrom(), history.getRangeTo(),
                history.getRequestedPages(), history.getReceivedRecords(), history.getInsertedRecords(),
                history.getUpdatedRecords(), history.getSkippedRecords(), history.getFailedRecords(),
                history.getTotalToiletCount(), history.getStartedAt(), history.getCompletedAt(), history.getErrorMessage()
        );
    }
}
