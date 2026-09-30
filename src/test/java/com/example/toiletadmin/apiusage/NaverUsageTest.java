package com.example.toiletadmin.apiusage;

import static org.assertj.core.api.Assertions.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.*;

class NaverUsageTest {
    private final ObjectMapper mapper=new ObjectMapper();
    private final Instant start=Instant.parse("2026-08-31T15:00:00Z"), now=Instant.parse("2026-09-30T00:00:00Z");
    private JsonNode row(String app,String type,int day,Object quantity) {
        return mapper.valueToTree(Map.of("contract",Map.of("contractNo",app,"contractType",Map.of("code","MAPS")),
                "contractProduct",Map.of("contractProductSequence","1"),
                "useDate",Map.of("useStartDate","2026-09-%02dT00:00:00+0900".formatted(day),"useEndDate","2026-09-%02dT23:59:59+0900".formatted(day)),
                "usage",Map.of("meteringType",Map.of("code",type),"unit",Map.of("code","REQ_CNT"),"usageQuantity",quantity)));
    }
    @Test void sumsAppsAtCommonCompletedDayAndKeepsGeocodingSeparate() {
        var snapshot=NaverUsageClient.parse(List.of(row("prod","MPDNM_MAPS",27,360),row("prod","MPDNM_MAPS",28,4),
                row("prod","MPDNM_MAPS",29,31),row("test","MPDNM_MAPS",27,376),row("test","MPDNM_MAPS",28,0),
                row("test","MPGEO_MAPS",27,9),row("test","MPGEO_MAPS",28,0)),start,now);
        assertThat(snapshot.asOf()).isEqualTo(Instant.parse("2026-09-28T15:00:00Z"));
        assertThat(snapshot.metrics().get("naver-map").used()).isEqualTo(740);
        assertThat(snapshot.metrics().get("naver-geocoding").used()).isEqualTo(9);
    }
    @Test void absentDataIsUnknownAndMeasuredZeroIsZero() {
        assertThatThrownBy(()->NaverUsageClient.parse(List.of(),start,now)).isInstanceOf(NaverUsageClient.NoUsageData.class);
        assertThat(NaverUsageClient.parse(List.of(row("prod","MPDNM_MAPS",28,0)),start,now).metrics().get("naver-map").used()).isZero();
    }
    @Test void rejectsUnknownMeterDuplicateAndNonNumericCounters() {
        var valid=row("prod","MPDNM_MAPS",28,3);
        assertThatThrownBy(()->NaverUsageClient.parse(List.of(valid,valid),start,now)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->NaverUsageClient.parse(List.of(row("prod","NEW_PRODUCT",28,3)),start,now)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->NaverUsageClient.parse(List.of(row("prod","MPDNM_MAPS",28,"3")),start,now)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->NaverUsageClient.parse(List.of(row("prod","MPDNM_MAPS",28,-1)),start,now)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void rejectsDayThatHasNotCompleted() {
        assertThatThrownBy(()->NaverUsageClient.parse(List.of(row("prod","MPDNM_MAPS",30,3)),start,now)).isInstanceOf(IllegalArgumentException.class);
    }
}
