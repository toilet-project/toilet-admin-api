package com.example.toiletadmin.global.controller;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/v1/map-config")
public class AdminMapConfigController {

    @Value("${kakao.javascript-key:}")
    private String javascriptKey;

    @GetMapping
    public Map<String, Object> getMapConfig() {
        return Map.of("enabled", javascriptKey != null && !javascriptKey.isBlank(), "javascriptKey", javascriptKey == null ? "" : javascriptKey);
    }
}
