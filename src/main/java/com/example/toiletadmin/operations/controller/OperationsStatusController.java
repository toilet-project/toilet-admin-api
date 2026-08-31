package com.example.toiletadmin.operations.controller;

import com.example.toiletadmin.operations.dto.OperationsStatusResponse;
import com.example.toiletadmin.operations.service.OperationsStatusService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/admin/v1/operations")
public class OperationsStatusController {

    private final OperationsStatusService operationsStatusService;

    @GetMapping("/status")
    public OperationsStatusResponse getStatus() {
        return operationsStatusService.getStatus();
    }
}
