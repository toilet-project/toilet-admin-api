package com.example.toiletadmin.global.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;

@RestController
public class HealthCheckController {

    @Autowired
    private DataSource dataSource;

    @GetMapping("/api/health")
    public String healthCheck() {
        try (Connection connection = dataSource.getConnection()) {
            return "✅ 서버 정상 작동 중 & 미니 PC MySQL 연결 성공! (DB: " + connection.getCatalog() + ")";
        } catch (Exception e) {
            return "❌ DB 연결 실패: " + e.getMessage();
        }
    }
}