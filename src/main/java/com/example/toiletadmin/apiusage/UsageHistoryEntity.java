package com.example.toiletadmin.apiusage;

import jakarta.persistence.*;

@Entity
@Table(name="api_usage_monthly_snapshots")
class UsageHistoryEntity {
    @Id @Column(length=80) String id;
    @Lob @Column(nullable=false, columnDefinition="LONGTEXT") String observation;
    protected UsageHistoryEntity() {}
    UsageHistoryEntity(String id, String observation) { this.id=id; this.observation=observation; }
}
