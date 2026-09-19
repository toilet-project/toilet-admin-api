package com.example.toiletadmin.operations.host;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class HostMetricsControllerTest {
    @Test void endpointIsReadOnlyUncachedAndRejectsUnboundedRanges() throws Exception {
        var mvc=MockMvcBuilders.standaloneSetup(new HostMetricsController(new HostMetricsService(""))).build();
        mvc.perform(get("/api/admin/v1/operations/host")).andExpect(status().isOk())
            .andExpect(header().string("Cache-Control","no-store")).andExpect(jsonPath("$.status").value("DISABLED"));
        mvc.perform(get("/api/admin/v1/operations/host").param("days","100000")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/admin/v1/operations/host/history").param("date","../../etc/passwd")).andExpect(status().isBadRequest());
    }
}
