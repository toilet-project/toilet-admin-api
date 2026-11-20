package com.example.toiletadmin.analytics.service;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.ArrayList;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Public source references only. A catalog miss is never an automation or maliciousness predicate. */
public final class OfficialCrawlerCatalog {
    private OfficialCrawlerCatalog() { }
    private record Reference(String key,String provider,String title,String url) { }
    public record Source(String key,String provider,String title,String url,String status,Long prefixCount,String fetchedAt) { }
    private static final List<Reference> REFERENCES=List.of(
        new Reference("google_common_crawlers","Google","일반 크롤러","https://developers.google.com/static/crawling/ipranges/common-crawlers.json"),
        new Reference("google_special_crawlers","Google","특수 크롤러","https://developers.google.com/static/crawling/ipranges/special-crawlers.json"),
        new Reference("google_user_triggered_fetchers","Google","사용자 요청 수집기","https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json"),
        new Reference("google_user_triggered_fetchers_google","Google","Google 사용자 요청 수집기","https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json"),
        new Reference("google_user_triggered_agents","Google","사용자 요청 에이전트","https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json"),
        new Reference("naver","Naver","Yeti","https://searchadvisor.naver.com/doc/naverbot.json"),
        new Reference("bing","Bing","Bingbot","https://www.bing.com/toolbox/bingbot.json"),
        new Reference("apple","Apple","Applebot","https://search.developer.apple.com/applebot.json"),
        new Reference("openai_gptbot","OpenAI","GPTBot","https://openai.com/gptbot.json"),
        new Reference("openai_searchbot","OpenAI","OAI-SearchBot","https://openai.com/searchbot.json"),
        new Reference("openai_chatgpt_user","OpenAI","ChatGPT-User","https://openai.com/chatgpt-user.json"),
        new Reference("openai_adsbot","OpenAI","AdsBot","https://openai.com/adsbot.json"),
        new Reference("openai_agents","OpenAI","ChatGPT Agents","https://openai.com/chatgpt-agents.json"),
        new Reference("openai_connectors","OpenAI","ChatGPT Connectors","https://openai.com/chatgpt-connectors.json"),
        new Reference("anthropic_bots","Anthropic","크롤러","https://claude.com/crawling/bots.json"),
        new Reference("anthropic_hosted_browser","Anthropic","호스팅 브라우저","https://claude.com/.well-known/sail"),
        new Reference("duckduckgo_crawler","DuckDuckGo","DuckDuckBot","https://duckduckgo.com/duckduckbot.json"),
        new Reference("duckduckgo_assist","DuckDuckGo","DuckAssistBot","https://duckduckgo.com/duckassistbot.json"),
        new Reference("ahrefs_crawlers","Ahrefs","크롤러 공개 IP","https://api.ahrefs.com/v3/public/crawler-ip-ranges")
    );
    static List<Source> read(String directory,JsonNode embedded,JsonMapper mapper,Instant now) {
        JsonNode metadata=embedded;
        if(metadata==null || !metadata.isObject()) {
            try {
                Path file=Path.of(directory).resolve("official-crawler-sources.json");
                if(!directory.isBlank() && Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)) {
                    try(var stream=Files.newInputStream(file,LinkOption.NOFOLLOW_LINKS)) {
                        byte[] bytes=stream.readNBytes(64001);
                        if(bytes.length>64000)throw new IllegalArgumentException();
                        JsonNode data=mapper.readTree(bytes);
                        if(data.path("schema").asInt()!=1 || !data.path("source").asText().equals("official-crawler-source-catalog"))throw new IllegalArgumentException();
                        metadata=data.path("officialSources");
                    }
                }
            } catch(Exception ignored) {metadata=null;}
        }
        List<Source> result=new ArrayList<>();
        for(Reference ref:REFERENCES) {
            String status="NOT_REPORTED",fetched=null;Long prefixes=null;
            try {
                JsonNode row=metadata==null?null:metadata.path(ref.key());
                if(row!=null && row.isObject() && row.path("url").asText().equals(ref.url())) {
                    if(!row.path("available").isBoolean())throw new IllegalArgumentException();
                    if(!row.path("available").asBoolean())status="UNAVAILABLE";
                    else {
                        Instant at=Instant.parse(row.path("fetchedAtUtc").asText());
                        JsonNode count=row.path("prefixCount");
                        if(at.isAfter(now.plusSeconds(60)) || !count.isIntegralNumber() || !count.canConvertToLong()
                                || count.asLong()<0 || count.asLong()>1_000_000)throw new IllegalArgumentException();
                        prefixes=count.asLong();fetched=at.toString();
                        status=Duration.between(at,now).getSeconds()>86400?"STALE":"OK";
                    }
                }
            } catch(Exception ignored) {status="NOT_REPORTED";fetched=null;prefixes=null;}
            result.add(new Source(ref.key(),ref.provider(),ref.title(),ref.url(),status,prefixes,fetched));
        }
        return List.copyOf(result);
    }
}
