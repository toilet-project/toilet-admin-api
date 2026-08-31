package com.example.toiletadmin.sync.repository;

import com.example.toiletadmin.sync.model.BatchSyncHistory;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BatchSyncHistoryRepository extends JpaRepository<BatchSyncHistory, Long> {

    List<BatchSyncHistory> findByCompletedAtBetweenOrderByCompletedAtDesc(LocalDateTime from, LocalDateTime to);

    @Query("""
            select h from BatchSyncHistory h where (:status is null or h.status = :status)
              and (:from is null or h.completedAt >= :from)
              and (:to is null or h.completedAt <= :to)
            """)
    Page<BatchSyncHistory> findByFilters(@Param("status") com.example.toiletadmin.sync.model.BatchSyncStatus status,
                                         @Param("from") LocalDateTime from, @Param("to") LocalDateTime to,
                                         Pageable pageable);
}
