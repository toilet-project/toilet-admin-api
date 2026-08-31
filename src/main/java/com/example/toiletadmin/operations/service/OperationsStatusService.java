package com.example.toiletadmin.operations.service;

import com.example.toiletadmin.operations.dto.OperationsStatusResponse;
import com.example.toiletadmin.sync.model.BatchSyncHistory;
import com.example.toiletadmin.sync.model.BatchSyncStatus;
import com.example.toiletadmin.sync.repository.BatchSyncHistoryRepository;
import java.io.File;
import java.time.Duration;
import java.time.LocalDateTime;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Service
public class OperationsStatusService {

    private final JdbcTemplate jdbcTemplate;
    private final BatchSyncHistoryRepository historyRepository;
    private final RestClient restClient;
    private final String apiHealthUrl;

    public OperationsStatusService(
            JdbcTemplate jdbcTemplate,
            BatchSyncHistoryRepository historyRepository,
            @Value("${operations.api-health-url:https://api.geupddong.com/api/health}") String apiHealthUrl
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.historyRepository = historyRepository;
        this.restClient = RestClient.create();
        this.apiHealthUrl = apiHealthUrl;
    }

    public OperationsStatusResponse getStatus() {
        LocalDateTime checkedAt = LocalDateTime.now();
        return new OperationsStatusResponse(
                up("관리자 서비스가 응답 중입니다."),
                databaseStatus(),
                publicApiStatus(),
                batchStatus(checkedAt),
                diskStatus(),
                checkedAt
        );
    }

    private OperationsStatusResponse.ServiceStatus databaseStatus() {
        try {
            Integer result = jdbcTemplate.queryForObject("select 1", Integer.class);
            return result != null && result == 1 ? up("MySQL 연결 정상") : down("MySQL 응답 이상");
        } catch (RuntimeException exception) {
            return down("MySQL 연결 실패");
        }
    }

    private OperationsStatusResponse.ServiceStatus publicApiStatus() {
        try {
            restClient.get().uri(apiHealthUrl).retrieve().toBodilessEntity();
            return up("공개 API 연결 정상");
        } catch (RuntimeException exception) {
            return down("공개 API 연결 실패");
        }
    }

    private OperationsStatusResponse.BatchStatus batchStatus(LocalDateTime checkedAt) {
        return historyRepository.findFirstByOrderByCompletedAtDesc()
                .map(history -> toBatchStatus(history, checkedAt))
                .orElseGet(() -> new OperationsStatusResponse.BatchStatus("UNKNOWN", null, "배치 실행 이력이 없습니다."));
    }

    private OperationsStatusResponse.BatchStatus toBatchStatus(BatchSyncHistory history, LocalDateTime checkedAt) {
        if (history.getStatus() == BatchSyncStatus.FAILED) {
            return new OperationsStatusResponse.BatchStatus("DOWN", history.getCompletedAt(), "마지막 배치가 실패했습니다.");
        }
        long elapsedHours = Math.max(0, Duration.between(history.getCompletedAt(), checkedAt).toHours());
        if (elapsedHours > 26) {
            return new OperationsStatusResponse.BatchStatus("STALE", history.getCompletedAt(), "최근 26시간 내 성공 이력이 없습니다.");
        }
        return new OperationsStatusResponse.BatchStatus("UP", history.getCompletedAt(), "최근 배치가 정상 완료되었습니다.");
    }

    private OperationsStatusResponse.DiskStatus diskStatus() {
        File root = new File("/");
        long total = root.getTotalSpace();
        long free = root.getUsableSpace();
        int usedPercent = total == 0 ? 0 : (int) Math.round((total - free) * 100.0 / total);
        String status = usedPercent >= 90 ? "DOWN" : usedPercent >= 80 ? "WARN" : "UP";
        return new OperationsStatusResponse.DiskStatus(status, free, total, usedPercent);
    }

    private OperationsStatusResponse.ServiceStatus up(String message) {
        return new OperationsStatusResponse.ServiceStatus("UP", message);
    }

    private OperationsStatusResponse.ServiceStatus down(String message) {
        return new OperationsStatusResponse.ServiceStatus("DOWN", message);
    }
}
