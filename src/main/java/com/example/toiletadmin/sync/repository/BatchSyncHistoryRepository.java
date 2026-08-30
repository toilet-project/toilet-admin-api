package com.example.toiletadmin.sync.repository;

import com.example.toiletadmin.sync.model.BatchSyncHistory;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BatchSyncHistoryRepository extends JpaRepository<BatchSyncHistory, Long> {

    List<BatchSyncHistory> findByCompletedAtBetweenOrderByCompletedAtDesc(LocalDateTime from, LocalDateTime to);
}
