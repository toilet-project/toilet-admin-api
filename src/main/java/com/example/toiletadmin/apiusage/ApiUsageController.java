package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/v1/api-usage")
public class ApiUsageController {
    private final ApiUsageService service;
    private final UsageHistoryService history;
    @org.springframework.beans.factory.annotation.Autowired
    public ApiUsageController(ApiUsageService service,UsageHistoryService history) { this.service=service; this.history=history; }
    public ApiUsageController(ApiUsageService service) { this(service,null); }
    @GetMapping("/history")
    public ResponseEntity<UsageHistoryService.History> history(@RequestParam String service) {
        try { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(history.history(service)); }
        catch(IllegalArgumentException ignored) { return ResponseEntity.badRequest().build(); }
    }
    @GetMapping
    public ResponseEntity<Report> report() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.report());
    }
    @GetMapping("/estimate")
    public ResponseEntity<Estimate> estimate(@RequestParam String metric, @RequestParam long quantity,
                                             @RequestParam(defaultValue = "true") boolean includeFree) {
        if (quantity < 0 || quantity > UsagePricing.MAX_QUANTITY) return ResponseEntity.badRequest().build();
        try { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.estimate(metric, quantity, includeFree)); }
        catch (IllegalArgumentException ignored) { return ResponseEntity.badRequest().build(); }
    }
}
