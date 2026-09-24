#!/usr/bin/env python3
"""Offline Nginx combined-log reader. Never runs in an HTTP request handler.

Only allowlisted aggregate dimensions leave memory. Raw IP/UA/URLs are not stored.
Installation, trusted real-IP configuration and scheduling require a separate rollout.
"""
import argparse
import datetime as dt
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import urllib.request

UTC = dt.timezone.utc
KST = dt.timezone(dt.timedelta(hours=9))
SOURCES = {
    "google": "https://developers.google.com/static/crawling/ipranges/common-crawlers.json",
    "naver": "https://searchadvisor.naver.com/doc/naverbot.json",
    "bing": "https://www.bing.com/toolbox/bingbot.json",
}
# Name and provider are separate: ordinary Google Cloud traffic is not Googlebot.
BOTS = [
    (r"googlebot(?:-image|-video|-news)?", "Googlebot", "google"),
    (r"yeti", "Naver Yeti", "naver"),
    (r"bingbot", "Bingbot", "bing"),
    (r"ads-naver", "Naver Ads-Naver", None),
    (r"blueno", "Naver Blueno", None),
    (r"claude-searchbot", "Claude-SearchBot", None),
    (r"claudebot", "ClaudeBot", None),
    (r"claude-user", "Claude-User", None),
    (r"gptbot", "GPTBot", None),
    (r"oai-searchbot", "OAI-SearchBot", None),
    (r"chatgpt-user", "ChatGPT-User", None),
    (r"meta-externalagent", "Meta-ExternalAgent", None),
    (r"facebookexternalhit", "Facebook Preview", None),
]
BOTS = [(re.compile(r"(?:^|[\s;(])" + token + r"(?=[/\s;)]|$)", re.I), name, provider)
        for token, name, provider in BOTS]
LINE = re.compile(r'^([^ ]+) \S+ \S+ \[([^\]]+)\] "((?:[^"\\]|\\.)*)" (\d{3}) (?:\d+|-) "(?:[^"\\]|\\.)*" "((?:[^"\\]|\\.)*)"(?: .*)?$')
STATUSES = {"verified", "declared", "unmatched"}
PATHS = {"home", "toilet_detail", "regions", "sitemap", "robots", "toilets_api",
         "analytics_api", "auth_api", "admin", "assets", "other"}


def stamp(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_time(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def route_key(request):
    parts = request.split(" ")
    path = parts[1].split("?", 1)[0] if len(parts) == 3 else ""
    path = re.sub(r"^/(?:en|ja|zh-cn|zh-tw|zh-hk)(?=/|$)", "", path) or "/"
    if path == "/": return "home"
    if re.fullmatch(r"/toilet/[^/]+/?", path): return "toilet_detail"
    if path == "/regions" or path.startswith("/regions/"): return "regions"
    if re.fullmatch(r"/sitemap(?:[\w/-]*)\.xml", path): return "sitemap"
    if path == "/robots.txt": return "robots"
    if path == "/api/v1/toilets" or path.startswith("/api/v1/toilets/"): return "toilets_api"
    if path == "/api/v1/analytics/events": return "analytics_api"
    if path.startswith("/api/v1/auth/"): return "auth_api"
    if path.startswith("/api/admin/"): return "admin"
    if re.search(r"\.(?:css|js|svg|png|jpg|ico|woff2?)$", path): return "assets"
    return "other"


def identify(ua):
    for pattern, name, provider in BOTS:
        if pattern.search(ua): return name, provider
    if re.search(r"bot|crawler|spider|headless|preview", ua, re.I):
        return "Other bot", None
    return None, None


def fetch_ranges(now, providers=None):
    """Fixed HTTPS sources only; no user-supplied URLs or per-visitor DNS requests."""
    result = {}
    for provider, url in SOURCES.items():
        if providers is not None and provider not in providers: continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Geupddong-Origin-Bot-Registry/1.0"})
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.geturl() != url: raise ValueError("Unexpected redirect")
                raw = response.read(1_000_001)
            if len(raw) > 1_000_000: raise ValueError("Registry too large")
            prefixes = json.loads(raw)["prefixes"]
            networks = [str(ipaddress.ip_network(value)) for item in prefixes
                        for key, value in item.items() if key in ("ipv4Prefix", "ipv6Prefix")]
            if not networks or len(networks) > 10000: raise ValueError("Invalid registry")
            result[provider] = {"fetchedAt": stamp(now), "networks": networks}
        except Exception:
            # Never echo responses/headers or accidentally treat failure as verification.
            continue
    return result


class Verifier:
    def __init__(self, registry, now, trusted):
        self.networks = {}
        self.now = now
        if not trusted: return
        for provider, entry in registry.items():
            try:
                fetched = parse_time(entry["fetchedAt"])
                if not dt.timedelta(0) <= now - fetched <= dt.timedelta(hours=24): continue
                networks = [ipaddress.ip_network(n) for n in entry["networks"]]
                if provider in SOURCES and networks: self.networks[provider] = (fetched, networks)
            except (ValueError, KeyError, TypeError):
                continue

    def check(self, provider, address, occurred):
        if provider not in self.networks: return "declared"
        fetched, networks = self.networks[provider]
        # Today's list cannot prove ownership of old historical requests.
        if abs((occurred - fetched).total_seconds()) > 86400: return "declared"
        try:
            ip = ipaddress.ip_address(address)
            return "verified" if any(ip.version == n.version and ip in n for n in networks) else "unmatched"
        except ValueError:
            return "declared"


def database(path):
    db = sqlite3.connect(path, timeout=1)
    db.executescript("""
      CREATE TABLE IF NOT EXISTS cursor(id TEXT PRIMARY KEY, offset INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hits(day TEXT, hour TEXT, bot TEXT, verification TEXT, path TEXT,
        status INTEGER, count INTEGER NOT NULL, first TEXT, last TEXT,
        PRIMARY KEY(day,hour,bot,verification,path,status));
    """)
    return db


def parse_record(raw, verifier, now):
    match = LINE.fullmatch(raw.decode("utf-8", errors="replace").rstrip("\r\n"))
    if not match: return False, None
    address, when, request, status, ua = match.groups()
    name, provider = identify(ua)
    if not name: return True, None
    try:
        occurred = dt.datetime.strptime(when, "%d/%b/%Y:%H:%M:%S %z").astimezone(UTC)
    except ValueError:
        return False, None
    day = occurred.astimezone(KST).date().isoformat()
    cutoff = (now.astimezone(KST).date() - dt.timedelta(days=34)).isoformat()
    if day < cutoff or occurred > now + dt.timedelta(minutes=1): return True, None
    code = int(status) // 100
    if code not in range(1, 6): return False, None
    at = stamp(occurred)
    return True, (day, stamp(occurred.replace(minute=0, second=0)), name,
                  verifier.check(provider, address, occurred), route_key(request), code, at, at)


def store_record(db, values):
    db.execute("""INSERT INTO hits VALUES(?,?,?,?,?,?,1,?,?)
      ON CONFLICT(day,hour,bot,verification,path,status) DO UPDATE SET
      count=count+1, first=MIN(first,excluded.first), last=MAX(last,excluded.last)""", values)


def consume(db, files, verifier, now, max_lines=100000, seconds=15):
    cutoff = (now.astimezone(KST).date() - dt.timedelta(days=34)).isoformat()
    started = time.monotonic()
    processed = malformed = 0
    backlog = False
    seen_ids = set()
    for path in files:
        if not path.exists() or path.is_symlink(): continue
        with path.open("rb") as stream:
            stat = os.fstat(stream.fileno())
            key = f"{stat.st_dev}:{stat.st_ino}"
            if key in seen_ids: continue
            seen_ids.add(key)
            previous = db.execute("SELECT offset FROM cursor WHERE id=?", (key,)).fetchone()
            offset = previous[0] if previous else 0
            if offset > stat.st_size:
                db.execute("INSERT OR REPLACE INTO meta VALUES('coverageWarning','log-truncated')")
                offset = 0
            stream.seek(offset)
            while True:
                if processed >= max_lines or time.monotonic() - started >= seconds:
                    backlog = True
                    break
                before = stream.tell()
                raw = stream.readline(65537)
                if not raw: break
                if len(raw) > 65536:
                    # Discard oversized records, consuming the entire line with bounded reads.
                    while raw and not raw.endswith(b"\n"): raw = stream.readline(65537)
                    processed += 1; malformed += 1
                    continue
                if not raw.endswith(b"\n"):
                    stream.seek(before)  # An in-progress Nginx line will be read next time.
                    break
                processed += 1
                valid, values = parse_record(raw, verifier, now)
                if not valid:
                    malformed += 1
                    continue
                if values: store_record(db, values)
            db.execute("INSERT OR REPLACE INTO cursor VALUES(?,?)", (key, stream.tell()))
    # A missing old inode can mean collection missed rotation. Do not imply complete coverage.
    missing = set(row[0] for row in db.execute("SELECT id FROM cursor")) - seen_ids
    if missing:
        db.execute("INSERT OR REPLACE INTO meta VALUES('coverageWarning','rotated-log-unavailable')")
        for key in missing: db.execute("DELETE FROM cursor WHERE id=?", (key,))
    db.execute("DELETE FROM hits WHERE day < ?", (cutoff,))
    db.execute("INSERT OR IGNORE INTO meta VALUES('startedAt',?)", (stamp(now),))
    db.commit()
    return {"processed": processed, "malformed": malformed, "backlog": backlog}


def export(db, now, progress):
    rows = db.execute("SELECT day,hour,bot,verification,path,status,count,first,last FROM hits ORDER BY hour DESC,bot LIMIT 20001").fetchall()
    keys = ("day", "hour", "bot", "verification", "path", "status", "count", "first", "last")
    metadata = dict(db.execute("SELECT key,value FROM meta"))
    return {"schema": 1, "source": "origin-nginx", "generatedAt": stamp(now),
            "startedAt": metadata.get("startedAt", stamp(now)), "retentionDays": 35,
            "coverageWarning": metadata.get("coverageWarning", ""),
            "truncated": len(rows) > 20000, "progress": progress,
            "rows": [dict(zip(keys, row)) for row in rows[:20000]]}


def atomic_json(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, separators=(",", ":"))
    os.replace(temporary, path)


def main():
    os.umask(0o027)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--export", type=Path, required=True)
    parser.add_argument("--refresh-ranges", action="store_true")
    parser.add_argument("--trusted-real-ip", action="store_true",
                        help="Only after verifying proxy trust and Nginx $remote_addr origin IP handling")
    args = parser.parse_args()
    if not args.log.is_file() or args.log.is_symlink(): parser.error("Readable regular access log required")
    args.state.mkdir(parents=True, exist_ok=True)
    args.export.mkdir(parents=True, exist_ok=True)
    # flock prevents duplicate counting and racing exports when cron invocations overlap.
    import fcntl
    with (args.state / "collector.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = dt.datetime.now(UTC)
        registry_path = args.state / "registry.json"
        registry = json.loads(registry_path.read_text()) if registry_path.exists() else {}
        if args.refresh_ranges:
            retry_path = args.state / "registry-attempt.json"
            attempted = parse_time(json.loads(retry_path.read_text())["at"]) if retry_path.exists() else now-dt.timedelta(days=1)
            if now-attempted >= dt.timedelta(hours=1):
                due = [p for p in SOURCES if p not in registry or now-parse_time(registry[p]["fetchedAt"]) >= dt.timedelta(hours=12)]
                if due:
                    registry.update(fetch_ranges(now, due))
                    atomic_json(registry_path, registry)
                    atomic_json(retry_path, {"at":stamp(now)})
        db = database(args.state / "aggregates.sqlite")
        try:
            files = [args.log.with_name(args.log.name + ".1"), args.log]
            progress = consume(db, files, Verifier(registry, now, args.trusted_real_ip), now)
            atomic_json(args.export / "origin-bots.json", export(db, now, progress))
        finally:
            db.close()
        print(json.dumps({"status": "ok", **progress}))


if __name__ == "__main__":
    main()
