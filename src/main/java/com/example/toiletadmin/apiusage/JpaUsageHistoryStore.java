package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import jakarta.persistence.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Component
public class JpaUsageHistoryStore implements UsageHistoryStore {
    @PersistenceContext private EntityManager entities;
    private final ObjectMapper mapper;
    public JpaUsageHistoryStore(ObjectMapper mapper) { this.mapper=mapper; }
    @Override @Transactional(readOnly=true)
    public Snapshot find(String service,String month) {
        var entity=entities.find(UsageHistoryEntity.class,service+":"+month);
        return entity==null ? null : mapper.readValue(entity.observation,Snapshot.class);
    }
    @Override @Transactional
    public void save(String service,Snapshot snapshot) {
        // Keep counters/provenance only; no credentials, billing balances, or upstream labels.
        var stripped=new Snapshot(snapshot.month(),snapshot.asOf(),snapshot.source(),snapshot.scope(),snapshot.metrics());
        entities.merge(new UsageHistoryEntity(service+":"+snapshot.month(),mapper.writeValueAsString(stripped)));
    }
}
