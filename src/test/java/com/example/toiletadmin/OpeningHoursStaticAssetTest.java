package com.example.toiletadmin;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class OpeningHoursStaticAssetTest {
    @Test
    void reviewWorkspaceExposesSourceDecisionScheduleAndNavigation() throws Exception {
        String html = resource("/static/opening-hours.html");
        String script = resource("/static/opening-hours.js");
        String shell = resource("/static/admin-shell.js");

        assertThat(html)
                .contains("개방시간 검토")
                .contains("공공데이터 원문");
        assertThat(script)
                .contains("/api/admin/v1/opening-hours/reviews")
                .contains("sourceChanged")
                .contains("opening-hours-days")
                .contains("schedulesFromForm")
                .contains("method:'PUT'");
        assertThat(shell)
                .contains("'/opening-hours.html','개방시간 검토'")
                .contains("'/opening-hours'")
                .contains("'opening-hours.css'");
    }

    private String resource(String path) throws Exception {
        try (var stream = getClass().getResourceAsStream(path)) {
            assertThat(stream).isNotNull();
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
