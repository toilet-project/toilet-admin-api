package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;

/** Store provider observations separately from the short-lived dashboard response cache. */
public interface UsageHistoryStore {
    Snapshot find(String service, String month) throws Exception;
    void save(String service, Snapshot snapshot) throws Exception;
}
