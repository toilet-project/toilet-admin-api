package com.example.toiletadmin.operations.dto;

import java.time.LocalDateTime;

public record OperationsStatusResponse(
        ServiceStatus admin,
        ServiceStatus database,
        ServiceStatus publicApi,
        BatchStatus batch,
        DiskStatus disk,
        LocalDateTime checkedAt
) {
    public record ServiceStatus(String status, String message) {}

    public record BatchStatus(String status, LocalDateTime completedAt, String message) {}

    public record DiskStatus(String status, long freeBytes, long totalBytes, int usedPercent) {}
}
