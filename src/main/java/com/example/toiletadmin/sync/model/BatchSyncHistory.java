package com.example.toiletadmin.sync.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Table(name = "batch_sync_history")
public class BatchSyncHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_name", length = 100, nullable = false)
    private String jobName;

    @Column(name = "trigger_type", length = 30, nullable = false)
    private String triggerType;

    @Enumerated(EnumType.STRING)
    @Column(length = 20, nullable = false)
    private BatchSyncStatus status;

    @Column(name = "range_from", nullable = false)
    private LocalDateTime rangeFrom;

    @Column(name = "range_to", nullable = false)
    private LocalDateTime rangeTo;

    @Column(name = "requested_pages", nullable = false)
    private int requestedPages;

    @Column(name = "received_records", nullable = false)
    private int receivedRecords;

    @Column(name = "inserted_records", nullable = false)
    private int insertedRecords;

    @Column(name = "updated_records", nullable = false)
    private int updatedRecords;

    @Column(name = "skipped_records", nullable = false)
    private int skippedRecords;

    @Column(name = "failed_records", nullable = false)
    private int failedRecords;

    @Column(name = "total_toilet_count")
    private Long totalToiletCount;

    @Column(name = "started_at", nullable = false)
    private LocalDateTime startedAt;

    @Column(name = "completed_at", nullable = false)
    private LocalDateTime completedAt;

    @Column(name = "error_message", length = 1000)
    private String errorMessage;
}
