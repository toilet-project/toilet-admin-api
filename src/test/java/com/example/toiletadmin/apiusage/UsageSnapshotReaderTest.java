package com.example.toiletadmin.apiusage;

import static org.assertj.core.api.Assertions.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

class UsageSnapshotReaderTest {
    private static final String CURRENT = """
            {"month":"2026-09","asOf":"2026-09-29T15:00:00Z","source":"manual test",
             "scope":"synthetic","metrics":{"kakao-map":{"used":25,"billableUsed":null}}}
            """;
    private static final String HISTORY = """
            {"month":"2026-08","asOf":"2026-08-31T15:00:00Z","source":"manual test",
             "scope":"synthetic","metrics":{"kakao-map":{"used":11,"billableUsed":null}}}
            """;
    private static String encoded() {
        String json="{\"current\":{\"kakao\":"+CURRENT+"},\"history\":{\"kakao\":{\"2026-08\":"+HISTORY+"}}}";
        return Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }
    @Test void protectedBundleSuppliesCurrentAndMonthlyHistory() throws Exception {
        var reader=new UsageSnapshotReader("",encoded(),new ObjectMapper());
        assertThat(reader.read("kakao").metrics().get("kakao-map").used()).isEqualTo(25);
        assertThat(reader.readMonth("kakao","2026-08").metrics().get("kakao-map").used()).isEqualTo(11);
        assertThat(reader.read("naver")).isNull();
        assertThat(reader.readMonth("kakao","2026-07")).isNull();
    }
    @Test void protectedFileTakesPriorityAndMalformedBundleFailsClosed(@TempDir Path directory) throws Exception {
        Files.writeString(directory.resolve("kakao.json"),HISTORY);
        var reader=new UsageSnapshotReader(directory.toString(),encoded(),new ObjectMapper());
        assertThat(reader.read("kakao").metrics().get("kakao-map").used()).isEqualTo(11);
        assertThatThrownBy(()->new UsageSnapshotReader("","invalid",new ObjectMapper()))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("Invalid protected usage snapshots");
    }
}
