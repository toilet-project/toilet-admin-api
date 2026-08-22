package com.example.toiletadmin.global.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.net.URI;

@Service
public class GeocodingService {@Value("${kakao.rest-api-key}")
private String apiKey;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 주소 정제 기반 2단계 폴백 좌표 조회
     * 1단계: 정제된 도로명주소 검색
     * 2단계: (실패 시) 정제된 지번주소 검색
     */
    public BigDecimal[] getCoordinateWithFallback(String roadAddress, String jibunAddress) {
        BigDecimal[] coords;

        // 1. 도로명 주소 날것(원본) 검색
        if (hasValue(roadAddress)) {
            coords = searchAddress(roadAddress);
            if (coords != null) return coords;

            // 2. 도로명 실패 시 괄호 제거 후 재검색
            String cleanedRoad = cleanAddress(roadAddress);
            if (hasValue(cleanedRoad) && !cleanedRoad.equals(roadAddress)) {
                coords = searchAddress(cleanedRoad);
                if (coords != null) return coords;
            }
        }

        // 3. 지번 주소 날것(원본) 검색
        if (hasValue(jibunAddress)) {
            coords = searchAddress(jibunAddress);
            if (coords != null) return coords;

            // 4. 지번 실패 시 괄호 제거 후 재검색
            String cleanedJibun = cleanAddress(jibunAddress);
            if (hasValue(cleanedJibun) && !cleanedJibun.equals(jibunAddress)) {
                coords = searchAddress(cleanedJibun);
                if (coords != null) return coords;
            }
        }

        // 모두 실패 시 null 반환
        return new BigDecimal[]{null, null};
    }

    // 주소 검색 API (/v2/local/search/address.json)
    private BigDecimal[] searchAddress(String address) {
        if (!hasValue(address)) return null;
        String url = "https://dapi.kakao.com/v2/local/search/address.json";
        return callKakaoApi(url, address);
    }

    // 카카오 API 공통 호출 메서드
    private BigDecimal[] callKakaoApi(String baseUrl, String query) {
        try {
            URI uri = UriComponentsBuilder.fromUriString(baseUrl)
                    .queryParam("query", query)
                    .build()
                    .encode()
                    .toUri();

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "KakaoAK " + apiKey);

            HttpEntity<String> entity = new HttpEntity<>(headers);
            ResponseEntity<String> response = restTemplate.exchange(uri, HttpMethod.GET, entity, String.class);

            JsonNode root = objectMapper.readTree(response.getBody());
            JsonNode documents = root.path("documents");

            if (documents.isArray() && documents.size() > 0) {
                JsonNode first = documents.get(0);
                BigDecimal longitude = new BigDecimal(first.path("x").asText());
                BigDecimal latitude = new BigDecimal(first.path("y").asText());
                return new BigDecimal[]{latitude, longitude};
            }
        } catch (Exception e) {
            System.err.println("카카오 API 호출 실패 [" + query + "]: " + e.getMessage());
        }
        return null;
    }

    /**
     * 주소 정제 메서드
     * - 괄호 및 괄호 안 내용 전체 제거: (역삼동, 강남빌딩 2층) -> ""
     * - ~ 뒤로 이어지는 부번/상세 범위 제거: 12-3~5 -> 12-3
     */
    private String cleanAddress(String address) {
        if (address == null) return "";
        return address
                .replaceAll("\\(.*?\\)", ""); // 괄호 포함 내부 문자열 제거

    }

    private boolean hasValue(String str) {
        return str != null && !str.isBlank();
    }
}
