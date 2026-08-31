package com.example.toiletadmin.sync.dto;

import java.util.List;
import org.springframework.data.domain.Page;

public record BatchSyncHistoryPageResponse(
        List<BatchSyncHistoryResponse> items,
        int page,
        int size,
        long totalElements,
        int totalPages
) {
    public static BatchSyncHistoryPageResponse from(Page<BatchSyncHistoryResponse> page) {
        return new BatchSyncHistoryPageResponse(page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
    }
}
