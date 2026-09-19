package com.example.toiletadmin.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class ServiceAnalyticsStaticAssetTest {

    @Test
    void labelsRealPagesAcquisitionChannelsAndInAppScreens() throws IOException {
        try (var stream = getClass().getResourceAsStream("/static/service-analytics.js")) {
            assertThat(stream).isNotNull();
            String script = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            assertThat(script)
                    .contains("'/toilet/:id': '화장실 상세'")
                    .contains("'/policies/privacy': '개인정보 처리방침'")
                    .contains("Direct: '직접/출처 없음'")
                    .contains("Internal: '내부 이동'")
                    .contains("screen_view: '화면 열기'")
                    .contains("review_list: '리뷰 전체보기'")
                    .doesNotContain("'/profile': '내 정보'")
                    .doesNotContain("'/notifications': '알림'");
        }
    }
}
