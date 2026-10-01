package com.example.toiletadmin.analytics.service;

import static org.junit.jupiter.api.Assertions.*;
import java.time.*;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class PopularToiletsServiceTest {
    JdbcTemplate jdbc; PopularToiletsService service;
    @BeforeEach void setup() {
        jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:h2:mem:popular_"+UUID.randomUUID()+";MODE=MySQL;DB_CLOSE_DELAY=-1","sa",""));
        jdbc.execute("CREATE TABLE toilet(toilet_id BIGINT PRIMARY KEY,name VARCHAR(100),road_address VARCHAR(255),jibun_address VARCHAR(255),visibility_status VARCHAR(30))");
        jdbc.execute("CREATE TABLE app_user(user_id BIGINT PRIMARY KEY,status VARCHAR(20))");
        jdbc.execute("CREATE TABLE toilet_view_stats(toilet_id BIGINT PRIMARY KEY,total_views BIGINT,first_view_at TIMESTAMP,last_view_at TIMESTAMP)");
        jdbc.execute("CREATE TABLE toilet_view_daily(view_date DATE,toilet_id BIGINT,views BIGINT)");
        jdbc.execute("CREATE TABLE toilet_like(user_id BIGINT,toilet_id BIGINT)");
        jdbc.update("INSERT INTO toilet VALUES(1,'중앙공원','대전 중구','', 'VISIBLE'),(2,'서울역','서울 중구','', 'VISIBLE'),(3,'숨긴 시설','','','HIDDEN_DUPLICATE'),(4,'100% 화장실','','','VISIBLE')");
        jdbc.update("INSERT INTO app_user VALUES(1,'ACTIVE'),(2,'WITHDRAWN')");
        jdbc.update("INSERT INTO toilet_like VALUES(1,1),(2,1)");
        for(long id=1;id<=4;id++)jdbc.update("INSERT INTO toilet_view_stats VALUES(?,100,'2026-09-20 00:00:00','2026-10-01 01:00:00')",id);
        jdbc.update("INSERT INTO toilet_view_daily VALUES('2026-10-01',1,3),('2026-09-30',1,4),('2026-10-01',2,8),('2026-10-01',3,999),('2026-10-01',4,2),('2026-09-01',1,93)");
        service=new PopularToiletsService(jdbc,Clock.fixed(Instant.parse("2026-10-01T03:00:00Z"),ZoneOffset.UTC)) { @Override protected boolean ready(){return true;} };
    }
    @Test void ranksPublicFacilitiesAndSeparatesDateViewsTotalsAndActiveLikes() {
        var r=service.report("7d",null,null,"","views",0,15);
        assertEquals(17,r.views());assertEquals(3,r.facilities());assertEquals(2,r.items().getFirst().toiletId());
        var central=r.items().get(1);assertEquals(7,central.views());assertEquals(100,central.totalViews());assertEquals(1,central.likes());
        assertEquals(4,service.report("yesterday",null,null,"","views",0,15).views());
        assertEquals(2,service.report("today",null,null,"%","views",0,15).views());
    }
    @Test void pagingFilteringAndValidation() {
        var first=service.report("today",null,null,"","likes",0,1);assertTrue(first.hasMore());assertEquals(1,first.items().getFirst().toiletId());
        assertEquals(8,service.report("today",null,null,"서울","views",0,15).views());
        assertEquals(0,service.report("today",null,null,"없는곳","views",0,15).facilities());
        assertThrows(IllegalArgumentException.class,()->service.report("custom","2026-10-01","2026-10-02","","views",0,15));
        assertThrows(IllegalArgumentException.class,()->service.report("7d",null,null,"","views; DROP TABLE toilet",0,15));
    }
    @Test void schemaNotReadyIsNotReportedAsCollectedZero() {
        var pending=new PopularToiletsService(jdbc) { @Override protected boolean ready(){return false;} };
        assertEquals("NOT_READY",pending.report("today",null,null,"","views",0,15).status());
    }
}
