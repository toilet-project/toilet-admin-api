package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.Map;
import org.hibernate.cfg.Configuration;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

class UsageHistoryPersistenceTest {
    @Test void monthlyObservationSurvivesNewStoreInstanceAndUpdatesTheSameMonth() {
        try(var factory=new Configuration().addAnnotatedClass(UsageHistoryEntity.class)
                .setProperty("hibernate.connection.driver_class","org.h2.Driver")
                .setProperty("hibernate.connection.url","jdbc:h2:mem:usage_history;MODE=MySQL;DB_CLOSE_DELAY=-1")
                .setProperty("hibernate.hbm2ddl.auto","create-drop").buildSessionFactory()) {
            var mapper=new ObjectMapper();
            try(var session=factory.openSession()) {
                var store=new JpaUsageHistoryStore(mapper); ReflectionTestUtils.setField(store,"entities",session);
                var tx=session.beginTransaction();
                store.save("google-maps",new Snapshot("2026-09",Instant.parse("2026-09-30T10:00:00Z"),"Monitoring","project-one",Map.of("maps-sdk",new Counter(50,null))));
                tx.commit();
            }
            try(var session=factory.openSession()) {
                var store=new JpaUsageHistoryStore(mapper); ReflectionTestUtils.setField(store,"entities",session);
                assertThat(store.find("google-maps","2026-09").metrics().get("maps-sdk").used()).isEqualTo(50);
                var tx=session.beginTransaction();
                store.save("google-maps",new Snapshot("2026-09",Instant.parse("2026-10-01T07:00:00Z"),"Monitoring","project-one",Map.of("maps-sdk",new Counter(56,null))));
                tx.commit(); session.clear();
                assertThat(store.find("google-maps","2026-09").metrics().get("maps-sdk").used()).isEqualTo(56);
                assertThat(session.createQuery("select count(e) from UsageHistoryEntity e",Long.class).getSingleResult()).isEqualTo(1);
                assertThat(store.find("google-maps","2026-08")).isNull();
            }
        }
    }
}
