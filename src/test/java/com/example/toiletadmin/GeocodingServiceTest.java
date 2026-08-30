package com.example.toiletadmin;

import com.example.toiletadmin.global.service.GeocodingService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
public class GeocodingServiceTest {

    @Autowired
    private GeocodingService geocodingService;

    @Test
    @DisplayName("카카오 지오코딩 3단계 폴백 임시 테스트")
    void testGeocodingWithCustomInputs() {
        // GIVEN: 테스트해보고 싶은 임의의 데이터 입력
        String roadAddress = "서을특별시 광진구 용마도시자연공원";  // 일부러 실패할 도로명
        String jibunAddress = "";              // 비어있는 지번
        String toiletName = "이촌종합시장 개방화장실";     // 키워드 검색용 화장실명

        // WHEN: 3단계 폴백 로직 실행
        BigDecimal[] coords = geocodingService.getCoordinateWithFallback(roadAddress, jibunAddress);

        // THEN: 결과 출력 및 검증
        System.out.println("==========================================");
        System.out.println("입력 도로명: " + roadAddress);
        System.out.println("입력 지번: " + jibunAddress);
        System.out.println("입력 건물/화장실명: " + toiletName);
        System.out.println("------------------------------------------");
        System.out.println("최종 결과 위도(y / Latitude) : " + coords[0]);
        System.out.println("최종 결과 경도(x / Longitude): " + coords[1]);
        System.out.println("==========================================");

        // 좌표가 null이 아닌지 확인
        assertThat(coords[0]).isNotNull();
        assertThat(coords[1]).isNotNull();
    }

}
