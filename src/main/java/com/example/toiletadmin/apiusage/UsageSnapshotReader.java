package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class UsageSnapshotReader {
    private final String directory;
    private final JsonNode inline;
    private final ObjectMapper mapper;
    @Autowired
    public UsageSnapshotReader(@Value("${api-usage.snapshot-directory:}") String directory,
                               @Value("${api-usage.manual-snapshots-base64:}") String encoded,
                               ObjectMapper mapper) {
        this.directory = directory;
        this.mapper = mapper;
        if (encoded == null || encoded.isBlank()) {
            inline = null;
        } else {
            try {
                if (encoded.length() > 131072) throw new IllegalArgumentException();
                byte[] decoded = Base64.getDecoder().decode(encoded);
                if (decoded.length > 65536) throw new IllegalArgumentException();
                JsonNode root = mapper.readTree(decoded);
                if (!root.isObject() || !root.path("current").isObject() || !root.path("history").isObject())
                    throw new IllegalArgumentException();
                inline = root;
            } catch (Exception ignored) {
                throw new IllegalArgumentException("Invalid protected usage snapshots");
            }
        }
    }
    public UsageSnapshotReader(String directory, ObjectMapper mapper) { this(directory, "", mapper); }
    public Snapshot read(String id) throws Exception {
        if (!id.matches("[a-z-]+")) throw new IllegalArgumentException("Invalid service");
        if (!directory.isBlank()) {
            Path path = Path.of(directory).resolve(id + ".json");
            if (Files.exists(path)) return readFile(path);
        }
        return readInline(inline == null ? null : inline.path("current").path(id));
    }
    public Snapshot readMonth(String id,String month) throws Exception {
        if (!id.matches("[a-z-]+") || !month.matches("\\d{4}-\\d{2}")) throw new IllegalArgumentException("Invalid history path");
        if (!directory.isBlank()) {
            Path path=Path.of(directory).resolve("history").resolve(id).resolve(month+".json");
            if(Files.exists(path)) return readFile(path);
        }
        return readInline(inline == null ? null : inline.path("history").path(id).path(month));
    }
    private Snapshot readFile(Path path) throws Exception {
        if(Files.size(path)>65536) throw new IllegalArgumentException("Snapshot too large");
        return mapper.readValue(Files.readString(path),Snapshot.class);
    }
    private Snapshot readInline(JsonNode node) throws Exception {
        return node == null || !node.isObject() ? null : mapper.readValue(node.toString(),Snapshot.class);
    }
}
