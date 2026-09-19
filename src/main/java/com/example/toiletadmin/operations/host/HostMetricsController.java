package com.example.toiletadmin.operations.host;

import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.BAD_REQUEST;
import tools.jackson.databind.node.ObjectNode;

/** Served only by the administrator application behind its existing Access boundary. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/admin/v1/operations/host")
public class HostMetricsController {
    private final HostMetricsService service;

    @GetMapping
    public ResponseEntity<ObjectNode> summary(@RequestParam(defaultValue = "7") int days) {
        try { return response(service.summary(days)); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(BAD_REQUEST, "지원하지 않는 조회 기간입니다."); }
    }

    @GetMapping("/history")
    public ResponseEntity<ObjectNode> history(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        try { return response(service.history(date)); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(BAD_REQUEST, "최근 30일의 날짜를 선택하세요."); }
    }

    private ResponseEntity<ObjectNode> response(ObjectNode body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}
