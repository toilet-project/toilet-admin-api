package com.example.toiletadmin.analytics.controller;

import com.example.toiletadmin.analytics.service.PopularToiletsService;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/v1/service-analytics/popular-toilets")
public class PopularToiletsController {
    private final PopularToiletsService service;
    public PopularToiletsController(PopularToiletsService service) {this.service=service;}
    @GetMapping
    public ResponseEntity<PopularToiletsService.Report> get(@RequestParam(defaultValue="7d") String range,
            @RequestParam(required=false) String from,@RequestParam(required=false) String to,
            @RequestParam(defaultValue="") String q,@RequestParam(defaultValue="views") String sort,
            @RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="15") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.report(range,from,to,q,sort,page,size));
    }
}
