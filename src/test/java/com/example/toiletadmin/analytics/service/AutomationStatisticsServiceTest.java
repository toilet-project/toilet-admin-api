package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AutomationStatisticsServiceTest {
    @TempDir Path directory;
    private static final Clock CLOCK=Clock.fixed(Instant.parse("2026-11-20T07:30:00Z"),ZoneOffset.UTC);
    private static final String FIXTURE="""
      {"schema":1,"source":"automation-statistics","generatedAt":"2026-11-20T07:30:00Z","lastCompletedAt":"2026-11-20T07:29:00Z",
       "status":"ready","period":{"from":"2026-11-14","to":"2026-11-20"},
       "job":{"intervalSeconds":300,"ruleVersion":"stats-pattern-v1","ledgerEnabled":true,"applyMode":"run"},
       "coverage":{"totalEvents":100,"matchedEvents":95,"eligibleSessions":10,"classifiedSessions":8,"flaggedEvents":20,"unmatchedEvents":5,"ambiguousEvents":0},
       "rawIp":"NEVER_EXPORT","errorCode":"NEVER_EXPORT",
       "daily":[{"date":"2026-11-19","classification":"PATTERN_INFERRED","reasonKey":"DISTRIBUTED_PASSIVE_PROFILE","sessions":8,"events":20,"views":8,"hash":"NEVER_EXPORT"},
                {"date":"2026-11-20","classification":"UA_SIGNAL","reasonKey":"UA_SIGNAL","sessions":5,"events":12,"views":5}]}
      """;
    private AutomationStatisticsService service(String json) throws Exception {
        Files.writeString(directory.resolve("automation-statistics.json"),json);
        return new AutomationStatisticsService(directory.toString(),CLOCK);
    }
    @Test void separatesDailySignalsAndInferencesWithCoverageWithoutIdentifiers() throws Exception {
        var report=service(FIXTURE).report("7d",null,null);
        assertThat(report.status()).isEqualTo("READY");assertThat(report.rows()).hasSize(2);
        assertThat(report.partial()).isTrue();assertThat(report.coverage().unmatchedEvents()).isEqualTo(5);
        assertThat(report.rows()).extracting(AutomationStatisticsService.Row::classification).containsExactly("PATTERN_INFERRED","UA_SIGNAL");
        assertThat(report.toString()).doesNotContain("NEVER_EXPORT").doesNotContain("hash=");
        assertThat(service(FIXTURE).report("today",null,null).rows()).hasSize(1);
    }
    @Test void acceptsMobilePatternReasonInCandidatePlansAndCompletedExports() throws Exception {
        for(String state:new String[]{"plan","ready"}) {
            String fixture=FIXTURE.replace("stats-pattern-v1","stats-pattern-v2-candidate")
                    .replace("DISTRIBUTED_PASSIVE_PROFILE","DISTRIBUTED_MOBILE_PASSIVE_PROFILE")
                    .replace("\"status\":\"ready\"","\"status\":\""+state+"\"")
                    .replace("\"applyMode\":\"run\"","\"applyMode\":\""+(state.equals("plan")?"plan":"run")+"\"");
            var report=service(fixture).report("7d",null,null);
            assertThat(report.status()).isEqualTo(state.toUpperCase(java.util.Locale.ROOT));
            assertThat(report.job().ruleVersion()).isEqualTo("stats-pattern-v2-candidate");
            assertThat(report.rows()).extracting(AutomationStatisticsService.Row::reason)
                    .containsExactly("DISTRIBUTED_MOBILE_PASSIVE_PROFILE","UA_SIGNAL");
            assertThat(report.rows().getFirst().classification()).isEqualTo("PATTERN_INFERRED");
            assertThat(report.toString()).doesNotContain("NEVER_EXPORT");
        }
    }
    @Test void missingDisabledBrokenAndSymlinkExportsAreNotReportedAsZero() throws Exception {
        assertThat(new AutomationStatisticsService("",CLOCK).report("7d",null,null).status()).isEqualTo("DISABLED");
        assertThat(new AutomationStatisticsService(directory.toString(),CLOCK).report("7d",null,null).status()).isEqualTo("NOT_READY");
        assertThat(service("{}").report("7d",null,null).status()).isEqualTo("UNAVAILABLE");
        Path target=directory.resolve("source.json");Files.writeString(target,FIXTURE);
        Files.delete(directory.resolve("automation-statistics.json"));Files.createSymbolicLink(directory.resolve("automation-statistics.json"),target);
        assertThat(new AutomationStatisticsService(directory.toString(),CLOCK).report("7d",null,null).status()).isEqualTo("UNAVAILABLE");
    }
    @Test void planErrorAndStaleNeverPretendTheJobCompletedSuccessfully() throws Exception {
        assertThat(service(FIXTURE.replace("\"ready\"","\"plan\"")).report("7d",null,null).status()).isEqualTo("PLAN");
        var error=service(FIXTURE.replace("\"ready\"","\"error\"" )).report("7d",null,null);
        assertThat(error.status()).isEqualTo("ERROR");assertThat(error.rows()).hasSize(2);
        assertThat(service(FIXTURE.replace("2026-11-20T07:30:00Z","2026-11-20T07:00:00Z").replace("2026-11-20T07:29:00Z","2026-11-20T06:59:00Z")).report("7d",null,null).status()).isEqualTo("STALE");
    }
    @Test void rejectsUnboundedOrUnknownFieldsThatCouldMisstateIdentityOrCounts() throws Exception {
        for(String bad:new String[]{FIXTURE.replace("DISTRIBUTED_PASSIVE_PROFILE","OFFICIAL_GOOGLE"),FIXTURE.replace("PATTERN_INFERRED","VERIFIED_HUMAN"),
                FIXTURE.replace("\"matchedEvents\":95","\"matchedEvents\":101"),FIXTURE.replace("\"events\":20","\"events\":-1"),
                FIXTURE.replace("\"reasonKey\":\"UA_SIGNAL\"","\"reasonKey\":\"KNOWN_BULK_CLIENT\""),FIXTURE.replace("2026-11-20T07:30:00Z","2026-11-20T07:35:00Z"),
                FIXTURE.replace("\"applyMode\":\"run\"","\"applyMode\":\"plan\""),FIXTURE.replace("\"ledgerEnabled\":true","\"ledgerEnabled\":false")}) {
            assertThat(service(bad).report("7d",null,null).status()).isEqualTo("UNAVAILABLE");
        }
    }
    @Test void coverageGapIsExplicitAndOwnedInventoryNeedNotStillQualify() throws Exception {
        var report=service(FIXTURE.replace("\"matchedEvents\":95","\"matchedEvents\":90").replace("\"eligibleSessions\":10","\"eligibleSessions\":0")).report("7d",null,null);
        assertThat(report.status()).isEqualTo("READY");assertThat(report.partial()).isTrue();
        assertThat(report.coverage().unaccountedEvents()).isEqualTo(5);assertThat(report.coverage().classifiedSessions()).isEqualTo(8);
    }
    @Test void duplicateDailyClassificationsCannotDoubleCount() throws Exception {
        String duplicate=FIXTURE.replace("\"date\":\"2026-11-20\",\"classification\":\"UA_SIGNAL\",\"reasonKey\":\"UA_SIGNAL\"", "\"date\":\"2026-11-19\",\"classification\":\"PATTERN_INFERRED\",\"reasonKey\":\"DISTRIBUTED_PASSIVE_PROFILE\"");
        assertThat(service(duplicate).report("7d",null,null).status()).isEqualTo("UNAVAILABLE");
    }
    @Test void catalogShowsEightProvidersAndNineteenReferencesWithoutPretendingTheyWereFetched() throws Exception {
        var report=service(FIXTURE).report("7d",null,null);
        assertThat(report.officialSources()).hasSize(19);
        assertThat(report.officialSources().stream().map(OfficialCrawlerCatalog.Source::provider).distinct().count()).isEqualTo(8);
        assertThat(report.officialSources()).allSatisfy(source->{
            assertThat(source.status()).isEqualTo("NOT_REPORTED");assertThat(source.fetchedAt()).isNull();assertThat(source.prefixCount()).isNull();
        });
    }
    @Test void optionalCatalogMetadataUsesOnlyExactOfficialUrlsAndNeverReturnsRawFields() throws Exception {
        Files.writeString(directory.resolve("official-crawler-sources.json"),"""
          {"schema":1,"source":"official-crawler-source-catalog","generatedAt":"2026-11-20T07:00:00Z","officialSources":{
          "naver":{"url":"https://searchadvisor.naver.com/doc/naverbot.json","available":true,"prefixCount":36,"fetchedAtUtc":"2026-11-20T07:00:00Z","addresses":"NEVER_EXPORT"},
          "bing":{"url":"https://private.invalid/NEVER_EXPORT","available":true,"prefixCount":99,"fetchedAtUtc":"2026-11-20T07:00:00Z"}}}
          """);
        var report=service(FIXTURE).report("7d",null,null);
        var naver=report.officialSources().stream().filter(s->s.key().equals("naver")).findFirst().orElseThrow();
        assertThat(naver.status()).isEqualTo("OK");assertThat(naver.prefixCount()).isEqualTo(36);
        assertThat(report.officialSources().stream().filter(s->s.key().equals("bing")).findFirst().orElseThrow().status()).isEqualTo("NOT_REPORTED");
        assertThat(report.toString()).doesNotContain("NEVER_EXPORT").doesNotContain("private.invalid");
    }
    @Test void actualAggregateExportSmokeWhenProvided() throws Exception {
        String export=System.getenv("AUTOMATION_STATISTICS_INTEGRATION_EXPORT"),catalog=System.getenv("AUTOMATION_STATISTICS_INTEGRATION_CATALOG");
        org.junit.jupiter.api.Assumptions.assumeTrue(export!=null && catalog!=null);
        var mapper=tools.jackson.databind.json.JsonMapper.builder().build();
        var source=mapper.readTree(Files.readString(Path.of(export)));
        var metadata=mapper.readTree(Files.readString(Path.of(catalog)));
        Instant latest=Instant.parse(source.path("generatedAt").asText());
        Instant catalogAt=Instant.parse(metadata.path("generatedAt").asText());if(catalogAt.isAfter(latest))latest=catalogAt;
        Files.copy(Path.of(export),directory.resolve("automation-statistics.json"));
        Files.copy(Path.of(catalog),directory.resolve("official-crawler-sources.json"));
        var report=new AutomationStatisticsService(directory.toString(),Clock.fixed(latest.plusSeconds(1),ZoneOffset.UTC))
                .report("custom",source.path("period").path("from").asText(),source.path("period").path("to").asText());
        assertThat(report.status()).isNotIn("UNAVAILABLE","NOT_READY","DISABLED");
        assertThat(report.job().applyMode()).isEqualTo("plan");
        long expected=0;for(var row:source.path("daily"))if(row.path("classification").asText().equals("PATTERN_INFERRED"))expected+=row.path("sessions").asLong();
        assertThat(report.rows().stream().filter(r->r.classification().equals("PATTERN_INFERRED")).mapToLong(AutomationStatisticsService.Row::sessions).sum()).isEqualTo(expected);
        assertThat(report.officialSources()).hasSize(19).allSatisfy(s->assertThat(s.status()).isEqualTo("OK"));
        assertThat(report.toString()).doesNotContain("visitor_hash","session_hash","planDigest","policyDigest");
    }
}
