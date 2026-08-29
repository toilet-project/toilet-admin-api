package com.example.toiletadmin.sync.service;

import com.example.toiletadmin.sync.dto.BatchSyncDailySummaryResponse;
import com.example.toiletadmin.sync.dto.BatchSyncHistoryResponse;
import com.example.toiletadmin.sync.model.BatchSyncHistory;
import com.example.toiletadmin.sync.model.BatchSyncStatus;
import com.example.toiletadmin.sync.repository.BatchSyncHistoryRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class BatchSyncHistoryService {

    private static final int DEFAULT_DAYS = 30;

    private final BatchSyncHistoryRepository historyRepository;

    public List<BatchSyncHistoryResponse> getExecutions(LocalDate from, LocalDate to) {
        return findHistories(from, to).stream().map(BatchSyncHistoryResponse::from).toList();
    }

    public List<BatchSyncDailySummaryResponse> getDailySummaries(LocalDate from, LocalDate to) {
        Map<LocalDate, List<BatchSyncHistory>> byDate = findHistories(from, to).stream()
                .collect(java.util.stream.Collectors.groupingBy(history -> history.getCompletedAt().toLocalDate()));

        return byDate.entrySet().stream()
                .map(entry -> summarize(entry.getKey(), entry.getValue()))
                .sorted(Comparator.comparing(BatchSyncDailySummaryResponse::date).reversed())
                .toList();
    }

    private List<BatchSyncHistory> findHistories(LocalDate from, LocalDate to) {
        LocalDate effectiveTo = to == null ? LocalDate.now() : to;
        LocalDate effectiveFrom = from == null ? effectiveTo.minusDays(DEFAULT_DAYS - 1) : from;
        if (effectiveFrom.isAfter(effectiveTo)) {
            throw new IllegalArgumentException("조회 시작일은 종료일보다 늦을 수 없습니다.");
        }
        return historyRepository.findByCompletedAtBetweenOrderByCompletedAtDesc(
                effectiveFrom.atStartOfDay(), effectiveTo.atTime(LocalTime.MAX)
        );
    }

    private BatchSyncDailySummaryResponse summarize(LocalDate date, List<BatchSyncHistory> histories) {
        int successfulRuns = (int) histories.stream().filter(history -> history.getStatus() == BatchSyncStatus.SUCCESS).count();
        int failedRuns = histories.size() - successfulRuns;
        BatchSyncHistory latestSuccess = histories.stream()
                .filter(history -> history.getStatus() == BatchSyncStatus.SUCCESS)
                .max(Comparator.comparing(BatchSyncHistory::getCompletedAt))
                .orElse(null);

        return new BatchSyncDailySummaryResponse(
                date,
                successfulRuns,
                failedRuns,
                histories.stream().mapToInt(BatchSyncHistory::getReceivedRecords).sum(),
                histories.stream().mapToInt(BatchSyncHistory::getInsertedRecords).sum(),
                histories.stream().mapToInt(BatchSyncHistory::getUpdatedRecords).sum(),
                histories.stream().mapToInt(BatchSyncHistory::getSkippedRecords).sum(),
                histories.stream().mapToInt(BatchSyncHistory::getFailedRecords).sum(),
                latestSuccess == null ? null : latestSuccess.getTotalToiletCount()
        );
    }
}
