package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import java.io.IOException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class UsageCatalog {
    private final Catalog catalog;
    public UsageCatalog(ObjectMapper mapper) throws IOException {
        try (var stream = new ClassPathResource("api-usage-catalog.json").getInputStream()) {
            catalog = mapper.readValue(stream, Catalog.class);
        }
    }
    public Catalog get() { return catalog; }
}
