#!/usr/bin/env python3
"""Statistics only: never changes HTTP handling. No source IP/UA/URL is persisted.

Run --plan first. The only application write is conditional UNFLAGGED -> BOT,
backed by a private SQLite write-ahead ledger. See README before installation.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import fcntl
import gzip
import hashlib
import hmac
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import select
import sqlite3
import subprocess
import sys
import time

KST = timezone(timedelta(hours=9))
RULE_VERSION = "stats-pattern-v2-candidate"
REVIEWED_DESKTOP_PROFILES = [
    ["Chrome", "120.0.0.0", "macOS"], ["Chrome", "118.0.0.0", "Windows"],
    ["Edge", "120.0.0.0", "Windows"], ["Chrome", "120.0.0.0", "Windows"],
    ["Firefox", "121.0", "macOS"], ["Chrome", "119.0.0.0", "macOS"],
    ["Firefox", "121.0", "Windows"], ["Firefox", "120.0", "Windows"],
    ["Edge", "119.0.0.0", "Windows"], ["Chrome", "119.0.0.0", "Windows"],
]
REVIEWED_MOBILE_PROFILES = [["Chrome", str(version) + ".0.0.0", os]
                           for version in range(147, 152) for os in ("Android", "iOS")]
POLICY = {"ruleVersion": RULE_VERSION, "windowDays": 7, "retentionDays": 35,
          "minStarts": 20, "minNetworks": 20, "directPercent": 95,
          "passivePercent": 90, "idleMinutes": 35, "maxEngagementSeconds": 30,
          "reviewedDesktopProfiles": REVIEWED_DESKTOP_PROFILES,
          "reviewedDesktopOnset": "2026-11-19T00:00:00+09:00",
          "reviewedOnsetPercent": 90,
          "reviewedMobileProfiles": REVIEWED_MOBILE_PROFILES,
          # Beginning of this follow-up review scope, not an asserted attack onset.
          "reviewedMobileOnset": "2026-11-20T20:19:16.221517+09:00",
          "mobileCohortThresholds": {"minStarts": 50, "minNetworks": 50, "directPercent": 99,
                                     "passivePercent": 95, "zeroPassivePercent": 95, "minObservedSpanHours": 24},
          "mobileEngagementSeconds": 0,
          "unknownCohorts": "REVIEW_ONLY",
          "knownPriorProfile": {"product": "Chrome", "version": "145.0.0.0", "os": "Linux"}}
SAFE_EVENTS = {"session_start", "page_view", "engagement"}
JAVA_TRIM = "".join(chr(n) for n in range(33))
REASONS = {"DISTRIBUTED_PASSIVE_PROFILE", "DISTRIBUTED_MOBILE_PASSIVE_PROFILE", "KNOWN_BULK_CLIENT"}
# Diagnostic output only; never changes policy eligibility or its pinned digest.
COHORT_EVIDENCE_LIMIT = 1000


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


POLICY_DIGEST = digest(POLICY)


def at(value):
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=KST) if parsed.tzinfo is None else parsed.astimezone(KST)


def stamp(value):
    return value.astimezone(KST).isoformat(timespec="microseconds")


def window_floor(cutoff):
    return cutoff.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=POLICY["windowDays"] - 1)


def run(command, *, data=None, env=None, timeout=20):
    result = subprocess.run(command, input=data, capture_output=True, text=True, env=env, timeout=timeout)
    if result.returncode:
        raise RuntimeError("HOST_COMMAND_FAILED")  # Never expose stderr/secrets/source rows.
    return result.stdout


class Database:
    def __init__(self):
        mysql, api = json.loads(run(["docker", "inspect", "toilet-mysql", "toilet-api"]))
        settings = dict(item.split("=", 1) for item in mysql["Config"].get("Env", []) if "=" in item)
        api_env = dict(item.split("=", 1) for item in api["Config"].get("Env", []) if "=" in item)
        name, password = settings.get("MYSQL_DATABASE", ""), settings.get("MYSQL_ROOT_PASSWORD")
        secret = api_env.get("SERVICE_ANALYTICS_VISITOR_SECRET", api_env.get("ANALYTICS_VISITOR_HMAC_SECRET", api_env.get("JWT_SECRET", "")))
        if not re.fullmatch(r"[A-Za-z0-9_]+", name) or not password or len(secret) < 32:
            raise RuntimeError("CONFIGURATION_UNAVAILABLE")
        self.key = hashlib.sha256(("service-analytics-v1\n" + secret).encode()).digest()
        self.env = os.environ.copy()
        self.env["MYSQL_PWD"] = password
        self.command = ["docker", "exec", "-i", "--env", "MYSQL_PWD", "toilet-mysql", "mysql", "--user=root",
                        "--batch", "--raw", "--skip-column-names", "--database=" + name]

    def select(self, sql):
        return run(self.command, data="SET SESSION time_zone='+00:00'; SET SESSION max_execution_time=10000; "
                   "SET SESSION TRANSACTION READ ONLY; START TRANSACTION WITH CONSISTENT SNAPSHOT;\n" + sql + ";\nROLLBACK;\n",
                   env=self.env, timeout=18)

    def rows(self, cutoff):
        # Read every retained event, so a next-day action protects the original session.
        start = cutoff - timedelta(days=POLICY["retentionDays"])
        low, high = start.strftime("%Y-%m-%d %H:%M:%S.%f"), cutoff.strftime("%Y-%m-%d %H:%M:%S.%f")
        sql = event_select() + " WHERE occurred_date>='%s' AND occurred_at>='%s' AND occurred_at<'%s' ORDER BY event_id" % (start.date(), low, high)
        rows = [json.loads(line) for line in self.select(sql).splitlines() if line.strip()]
        for row in rows:
            validate_row(row)
        return rows

    def transaction(self):
        return Transaction(self.command, self.env)


def event_select():
    return """SELECT JSON_OBJECT('id',CAST(event_id AS CHAR),'at',occurred_at,'day',occurred_date,
      'session',HEX(session_hash),'visitor',HEX(visitor_hash),'event',event_name,'traffic',traffic_class,
      'source',source_key,'channel',channel_key,'client',client_context,'navigation',entry_navigation,
      'engagement',COALESCE(engagement_seconds,0)) FROM service_analytics_event"""


class Transaction:
    """One bounded interactive connection; errors abort without exposing private SQL/results."""
    def __init__(self, command, env):
        self.process = subprocess.Popen(command + ["--unbuffered"], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        self.pending = b""
        self.execute("SET SESSION time_zone='+00:00'; SET SESSION max_execution_time=10000; "
                     "SET SESSION innodb_lock_wait_timeout=2; SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ; START TRANSACTION")

    def execute(self, sql):
        token = "__classifier_done_" + os.urandom(12).hex() + "__"
        self.process.stdin.write((sql + ";\nSELECT '" + token + "';\n").encode())
        self.process.stdin.flush()
        lines, deadline = [], time.monotonic() + 15
        while time.monotonic() < deadline:
            if b"\n" in self.pending:
                raw, self.pending = self.pending.split(b"\n", 1)
                line = raw.decode("utf-8")
                if line == token:
                    return lines
                if line:
                    lines.append(line)
                continue
            readable, _, _ = select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))
            if not readable:
                break
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                break
            self.pending += chunk
            if len(self.pending) + sum(map(len, lines)) > 8_000_000:
                break
        raise RuntimeError("TRANSACTION_FAILED")

    def close(self):
        if self.process.poll() is None:
            try:
                self.execute("ROLLBACK")
            except Exception:
                pass
            self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def locked_rows(transaction, sessions, cutoff):
    # Equality on both columns uses the existing (occurred_date,session_hash) index.
    # Retained dates + tomorrow protect cross-midnight arrivals without a table-wide lock.
    dates = []
    day = (cutoff - timedelta(days=POLICY["retentionDays"])).date()
    while day <= cutoff.date() + timedelta(days=1):
        dates.append("'" + str(day) + "'")
        day += timedelta(days=1)
    for session in sessions:
        if not re.fullmatch(r"[A-F0-9]{32,128}", session):
            raise RuntimeError("INVALID_SESSION")
    hashes = ",".join("UNHEX('" + session + "')" for session in sessions)
    sql = event_select() + " FORCE INDEX (idx_service_analytics_event_date_session) WHERE occurred_date IN (" + ",".join(dates) + ") AND session_hash IN (" + hashes + ") FOR UPDATE"
    rows = [json.loads(line) for line in transaction.execute(sql)]
    for row in rows:
        validate_row(row)
    return rows


def validate_row(row):
    if not re.fullmatch(r"[0-9]+", str(row["id"])) or not re.fullmatch(r"[A-F0-9]{32,128}", row["session"] or ""):
        raise RuntimeError("UNEXPECTED_EVENT_IDENTITY")
    if not re.fullmatch(r"[A-F0-9]{32,128}", row["visitor"] or ""):
        raise RuntimeError("UNEXPECTED_VISITOR_IDENTITY")
    at(row["at"])


def immutable(row):
    return digest({key: value for key, value in row.items() if key != "traffic"})


def open_state(path=None, readonly=False):
    if readonly or path is None:
        db = sqlite3.connect(":memory:")
        if path is not None and Path(path).exists():
            source = sqlite3.connect("file:" + str(Path(path).resolve()) + "?mode=ro", uri=True)
            source.backup(db)
            source.close()
    else:
        Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        db = sqlite3.connect(path)
        os.chmod(path, 0o600)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (identity TEXT PRIMARY KEY,path TEXT NOT NULL,offset INTEGER NOT NULL,
        anchor TEXT NOT NULL,head TEXT NOT NULL,size INTEGER NOT NULL,errors INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mappings (visitor TEXT NOT NULL,ua_key TEXT NOT NULL,network_key TEXT NOT NULL,
        profile TEXT NOT NULL,known_prior INTEGER NOT NULL,first_at TEXT NOT NULL,last_at TEXT NOT NULL,
        PRIMARY KEY(visitor,ua_key,network_key,profile));
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY,created_at TEXT NOT NULL,plan_digest TEXT NOT NULL,
        action TEXT NOT NULL,status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (event_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,session TEXT NOT NULL,
        occurred_at TEXT NOT NULL,day TEXT NOT NULL,previous_class TEXT NOT NULL CHECK(previous_class='UNFLAGGED'),
        fingerprint TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_rollups (day TEXT PRIMARY KEY,updated_at TEXT NOT NULL);
    """)
    return db


def load_parser(path):
    spec = importlib.util.spec_from_file_location("origin_parser", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_identity(key, address, ua, when, parser):
    address, ua = address.strip(JAVA_TRIM), ua.strip(JAVA_TRIM)
    ip = ipaddress.ip_address(address)
    canonical_network = str(ipaddress.ip_network(str(ip) + ("/24" if ip.version == 4 else "/64"), strict=False))
    if "." in address:
        parts = address.split(".")
        network = ".".join(parts[:3]) + ".0/24" if len(parts) == 4 else "unknown"
    else:
        parts = address.split(":")
        while parts and parts[-1] == "":
            parts.pop()
        network = ":".join(parts[:4]) + "::/64" if len(parts) >= 4 else "unknown"
    if not ua:
        raise ValueError("empty UA")
    month = datetime.fromtimestamp(when, KST).strftime("%Y-%m")
    def mac(value):
        return hmac.new(key, value.encode(), hashlib.sha256).hexdigest().upper()
    profile = json.loads(parser.ua_context(ua))
    # The metadata parser emits normalized product/version/OS/app tokens, never full UA.
    allowed = {name: profile.get(name) for name in ("product", "version", "os", "app", "declaredBot", "automationToken", "headlessToken", "missingUserAgent")}
    return (mac(month + "\n" + network + "\n" + ua), mac("ua\n" + month + "\n" + ua),
            mac("network\n" + month + "\n" + canonical_network), canonical(allowed),
            int(canonical_network == "216.246.215.0/24"))


def scan_logs(state, paths, key, parser, cutoff, seconds=50):
    if not paths:
        raise RuntimeError("SOURCE_LOGS_UNAVAILABLE")
    deadline = time.monotonic() + seconds
    latest_source_time = datetime.now(KST).timestamp() + 60
    floor = cutoff - timedelta(days=POLICY["retentionDays"])
    counts, complete = Counter(linesScanned=0, acceptedAnalyticsRequests=0, candidateParseFailures=0), True
    cache = {}
    for source in sorted(set(map(str, paths))):
        if time.monotonic() >= deadline:
            complete = False
            break
        path = Path(source)
        info = path.stat()
        identity = str(info.st_dev) + ":" + str(info.st_ino)
        previous = state.execute("SELECT * FROM files WHERE identity=?", (identity,)).fetchone()
        offset, errors = (previous["offset"], previous["errors"]) if previous else (0, 0)
        compressed = path.suffix == ".gz"
        with (gzip.open(path, "rb") if compressed else path.open("rb")) as stream:
            head = hashlib.sha256(stream.read(256)).hexdigest()
            stream.seek(0)
            if previous and (head != previous["head"] or compressed and info.st_size != previous["size"]):
                offset, errors = 0, 0
            if not compressed:
                actual = os.fstat(stream.fileno())
                if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
                    raise RuntimeError("LOG_REPLACED_DURING_OPEN")
                if offset > info.st_size:
                    offset, errors = 0, 0
                stream.seek(max(0, offset - 64))
                anchor = hashlib.sha256(stream.read(min(offset, 64))).hexdigest()
                if previous and offset and anchor != previous["anchor"]:
                    offset, errors = 0, 0  # copytruncate/rewrite: rescan, mappings merge idempotently.
                stream.seek(offset)
            else:
                # gzip.seek can hide an unbounded decompression pass. Bound it explicitly.
                while stream.tell() < offset and time.monotonic() < deadline:
                    if not stream.read(min(65536, offset - stream.tell())):
                        offset, errors = 0, 0
                        stream.seek(0)
                        break
                if time.monotonic() >= deadline:
                    complete = False
                    break
            while compressed or stream.tell() < info.st_size:
                if time.monotonic() >= deadline:
                    complete = False
                    break
                before = stream.tell()
                raw = stream.readline(1_048_577)
                if not raw:
                    break
                if not raw.endswith(b"\n"):
                    if len(raw) > 1_048_576:
                        while raw and not raw.endswith(b"\n"):
                            if time.monotonic() >= deadline:
                                complete = False
                                break
                            raw = stream.readline(1_048_577)
                        errors += 1
                        if not complete:
                            offset = before
                            break
                        offset = stream.tell()
                        continue
                    stream.seek(before)
                    complete = False
                    break  # A currently written trailing line is retried, never discarded.
                offset = stream.tell()
                counts["linesScanned"] += 1
                if b"/api/v1/analytics/events" not in raw or b"POST" not in raw:
                    continue
                try:
                    address, when, request, status, ua, *_ = parser.parse_line(raw, cache)
                    # Include accepted records after the DB snapshot cutoff in metadata too;
                    # advancing the cursor must never discard future-run identities.
                    if when < floor.timestamp() or when > latest_source_time:
                        continue
                    parts = request.split(" ", 2)
                    if len(parts) < 2 or parts[0] != "POST" or parts[1].split("?", 1)[0].rstrip("/") != "/api/v1/analytics/events" or not 200 <= status < 300:
                        continue
                    mapped = source_identity(key, address, ua, when, parser)
                    seen = stamp(datetime.fromtimestamp(when, KST))
                    state.execute("""INSERT INTO mappings VALUES(?,?,?,?,?,?,?) ON CONFLICT(visitor,ua_key,network_key,profile)
                      DO UPDATE SET first_at=MIN(first_at,excluded.first_at),last_at=MAX(last_at,excluded.last_at)""", (*mapped, seen, seen))
                    counts["acceptedAnalyticsRequests"] += 1
                except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                    errors += 1
            if compressed:
                anchor = "compressed"
            else:
                stream.seek(max(0, offset - 64))
                anchor = hashlib.sha256(stream.read(min(offset, 64))).hexdigest()
        state.execute("INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?,?,?)", (identity, source, offset, anchor, head, info.st_size, errors, stamp(cutoff)))
        counts["candidateParseFailures"] += errors
        complete = complete and errors == 0
    state.commit()
    return {"complete": complete, **counts}


def mappings(state):
    result = defaultdict(list)
    for row in state.execute("SELECT * FROM mappings"):
        result[row["visitor"]].append(dict(row))
    return result


def owned_ledger(state):
    return {row["event_id"]: dict(row) for row in state.execute("SELECT * FROM ledger WHERE status IN ('prepared','applied')")}


def analyze(rows, mapping, owned, cutoff, suppressed=None):
    suppressed = suppressed or set()
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["session"]].append(row)
    sessions, cohorts, coverage = {}, defaultdict(list), Counter()
    orphan_restore = []
    floor = window_floor(cutoff)
    for row in rows:
        if floor <= at(row["at"]) < cutoff:
            coverage["totalEvents"] += 1
            link = mapping.get(row["visitor"], [])
            coverage["matchedEvents" if len(link) == 1 else "ambiguousEvents" if link else "unmatchedEvents"] += 1
    for session, events in grouped.items():
        starts = sorted((row for row in events if row["event"] == "session_start"), key=lambda row: int(row["id"]))
        in_period = bool(starts) and floor <= at(starts[0]["at"]) < cutoff
        engagement = sum(float(row["engagement"] or 0) for row in events)
        if not starts:
            contrary = any(row["event"] not in SAFE_EVENTS or row["client"] not in (None, "UNKNOWN", "BROWSER", "WEB", "NONE") or row["source"] not in ("none", "unknown") or row["channel"] not in ("Direct", "Unassigned") or row["navigation"] in ("RELOAD", "HISTORY", "CONTINUATION") for row in events) or sum(row["event"] == "page_view" for row in events) > 1 or engagement > POLICY["maxEngagementSeconds"]
            mobile_positive = engagement > POLICY["mobileEngagementSeconds"] and any(
                row["id"] in owned and owned[row["id"]]["reason"] == "DISTRIBUTED_MOBILE_PASSIVE_PROFILE" for row in events)
            if contrary or mobile_positive:
                orphan_restore.extend(row for row in events if row["id"] in owned and row["traffic"] == "BOT"
                                      and owned[row["id"]]["fingerprint"] == immutable(row)
                                      and (contrary or owned[row["id"]]["reason"] == "DISTRIBUTED_MOBILE_PASSIVE_PROFILE"))
                sessions[session] = {"session": session, "events": events, "inPeriod": False, "originalUnflagged": False, "link": None}
            continue
        if not in_period and not any(row["id"] in owned for row in events):
            continue
        start = starts[0]
        links = [mapping.get(row["visitor"], []) for row in events]
        exact = all(len(link) == 1 for link in links)
        same_ua = exact and len({link[0]["ua_key"] for link in links}) == 1
        same_network = exact and len({link[0]["network_key"] for link in links}) == 1
        link = links[0][0] if exact and same_ua and same_network else None
        original_unflagged = not any(row["id"] in suppressed for row in events) and all(row["traffic"] == "UNFLAGGED" or (row["traffic"] == "BOT" and row["id"] in owned and owned[row["id"]]["fingerprint"] == immutable(row)) for row in events)
        profile = json.loads(link["profile"]) if link else {}
        app = bool(profile.get("app")) or any(row["client"] not in (None, "UNKNOWN", "BROWSER", "WEB", "NONE") for row in events)
        functional = any(row["event"] not in SAFE_EVENTS for row in events)
        direct = all(row["source"] in ("none", "unknown") and row["channel"] in ("Direct", "Unassigned") for row in events)
        views = sum(row["event"] == "page_view" for row in events)
        reentry = any(row["navigation"] in ("RELOAD", "HISTORY", "CONTINUATION") for row in events)
        passive = len(starts) == 1 and views == 1 and not functional and not app and not reentry
        bounded = engagement <= POLICY["maxEngagementSeconds"]
        closed = max(at(row["at"]) for row in events) <= cutoff - timedelta(minutes=POLICY["idleMinutes"])
        value = {"session": session, "events": events, "start": start, "link": link,
                 "originalUnflagged": original_unflagged, "app": app, "functional": functional,
                 "direct": direct, "views": views, "passive": passive, "bounded": bounded, "closed": closed,
                 "singleStart": len(starts) == 1, "reentry": reentry,
                 "zeroEngagement": engagement == POLICY["mobileEngagementSeconds"]}
        value["inPeriod"] = in_period
        sessions[session] = value
        # Global rolling cohort, independent of admin filters and including our prior BOT changes.
        if in_period and original_unflagged and link and not profile.get("declaredBot"):
            cohorts[link["ua_key"]].append(value)
    strong, strong_mobile = set(), set()
    for ua_key, members in cohorts.items():
        n = len(members)
        if n >= POLICY["minStarts"] and len({m["link"]["network_key"] for m in members}) >= POLICY["minNetworks"] and sum(m["direct"] for m in members) * 100 >= POLICY["directPercent"] * n and sum(m["passive"] for m in members) * 100 >= POLICY["passivePercent"] * n and sum(at(m["start"]["at"]) >= at(POLICY["reviewedDesktopOnset"]) for m in members) * 100 >= POLICY["reviewedOnsetPercent"] * n:
            strong.add(ua_key)
        profile = json.loads(members[0]["link"]["profile"])
        mobile_thresholds = POLICY["mobileCohortThresholds"]
        if [profile.get(k) for k in ("product", "version", "os")] in POLICY["reviewedMobileProfiles"]:
            span_seconds = (max(at(m["start"]["at"]) for m in members) - min(at(m["start"]["at"]) for m in members)).total_seconds()
            if n >= mobile_thresholds["minStarts"] and len({m["link"]["network_key"] for m in members}) >= mobile_thresholds["minNetworks"] and sum(m["direct"] for m in members) * 100 >= mobile_thresholds["directPercent"] * n and sum(m["passive"] for m in members) * 100 >= mobile_thresholds["passivePercent"] * n and sum(m["passive"] and m["zeroEngagement"] for m in members) * 100 >= mobile_thresholds["zeroPassivePercent"] * n and span_seconds >= mobile_thresholds["minObservedSpanHours"] * 3600:
                strong_mobile.add(ua_key)
    selected, restore = {}, orphan_restore
    for session, value in sessions.items():
        if "start" not in value:
            continue
        link = value["link"]
        eligible = value["inPeriod"] and value["originalUnflagged"] and link is not None and value["closed"] and value["direct"] and not value["app"] and not value["functional"] and value["singleStart"] and not value["reentry"] and value["bounded"]
        reason = None
        if eligible:
            coverage["eligibleSessions"] += 1
            profile = json.loads(link["profile"])
            prior = bool(link["known_prior"]) and all(profile.get(k) == v for k, v in POLICY["knownPriorProfile"].items())
            if prior and value["views"] <= 1:
                reason = "KNOWN_BULK_CLIENT"
            elif value["passive"] and link["ua_key"] in strong and [profile.get(k) for k in ("product", "version", "os")] in POLICY["reviewedDesktopProfiles"] and at(value["start"]["at"]) >= at(POLICY["reviewedDesktopOnset"]):
                reason = "DISTRIBUTED_PASSIVE_PROFILE"
            elif value["passive"] and value["zeroEngagement"] and link["ua_key"] in strong_mobile and [profile.get(k) for k in ("product", "version", "os")] in POLICY["reviewedMobileProfiles"] and at(value["start"]["at"]) >= at(POLICY["reviewedMobileOnset"]):
                reason = "DISTRIBUTED_MOBILE_PASSIVE_PROFILE"
        if reason:
            selected[session] = {**value, "reason": reason}
        # A previously flagged session that later gains any real interaction/app context is restored.
        if value["functional"] or value["app"] or value["views"] > 1 or not value["direct"] or not value["singleStart"] or value["reentry"] or not value["bounded"]:
            restore.extend(row for row in value["events"] if row["id"] in owned and row["traffic"] == "BOT" and owned[row["id"]]["fingerprint"] == immutable(row))
        elif not value["zeroEngagement"]:
            restore.extend(row for row in value["events"] if row["id"] in owned and row["traffic"] == "BOT"
                           and owned[row["id"]]["reason"] == "DISTRIBUTED_MOBILE_PASSIVE_PROFILE"
                           and owned[row["id"]]["fingerprint"] == immutable(row))
    preservation, mobile_preservation = Counter(), Counter()
    cohort_evidence = []
    for ua_key, members in cohorts.items():
        profile = json.loads(members[0]["link"]["profile"])
        n = len(members)
        networks = len({m["link"]["network_key"] for m in members})
        direct = sum(m["direct"] for m in members)
        passive = sum(m["passive"] for m in members)
        zero_passive = sum(m["passive"] and m["zeroEngagement"] for m in members)
        desktop_family = [profile.get(k) for k in ("product", "version", "os")] in POLICY["reviewedDesktopProfiles"]
        mobile_family = [profile.get(k) for k in ("product", "version", "os")] in POLICY["reviewedMobileProfiles"]
        thresholds = POLICY["mobileCohortThresholds"] if mobile_family else POLICY
        scope_start = POLICY["reviewedMobileOnset"] if mobile_family else POLICY["reviewedDesktopOnset"]
        since_onset = sum(at(m["start"]["at"]) >= at(scope_start) for m in members)
        span_seconds = (max(at(m["start"]["at"]) for m in members) - min(at(m["start"]["at"]) for m in members)).total_seconds()
        cohort_conditions = {"minStarts": n >= thresholds["minStarts"], "minNetworks": networks >= thresholds["minNetworks"],
                             "directPercent": direct * 100 >= thresholds["directPercent"] * n,
                             "passivePercent": passive * 100 >= thresholds["passivePercent"] * n}
        if mobile_family:
            cohort_conditions.update(zeroPassivePercent=zero_passive * 100 >= thresholds["zeroPassivePercent"] * n,
                                     minObservedSpanHours=span_seconds >= thresholds["minObservedSpanHours"] * 3600)
        else:
            cohort_conditions["reviewedOnsetPercent"] = since_onset * 100 >= thresholds["reviewedOnsetPercent"] * n
        # The population deliberately includes owned BOT sessions, as the selection
        # denominator does. Diagnostics never expose monthly UA/network hashes.
        common = sum(m["inPeriod"] and m["originalUnflagged"] and m["link"] is not None
                     and m["closed"] and m["direct"] and not m["app"] and not m["functional"]
                     and m["singleStart"] and not m["reentry"] and m["bounded"] for m in members)
        cohort_evidence.append({
            "browserProfile": {k: profile.get(k) for k in ("product", "version", "os")},
            "starts": n, "networkIdentities": networks,
            "directPercent": round(direct * 100 / n, 2), "passivePercent": round(passive * 100 / n, 2),
            "zeroPassivePercent": round(zero_passive * 100 / n, 2), "observedSpanHours": round(span_seconds / 3600, 6),
            "strong": ua_key in (strong_mobile if mobile_family else strong),
            "reviewedFamily": desktop_family or mobile_family,
            "reviewedFamilyKind": "MOBILE" if mobile_family else "DESKTOP" if desktop_family else "UNREVIEWED",
            "reviewScopeStart": scope_start,
            "eligibility": {
                "cohortConditions": cohort_conditions,
                "commonSafeguardSessions": common, "passiveSingleViewSessions": passive,
                "zeroPassiveSingleViewSessions": zero_passive,
                "zeroEngagementSessions": sum(m["zeroEngagement"] for m in members),
                "reviewedOnsetSessions": since_onset,
                "knownPriorProfileAndNetworkSessions": sum(bool(m["link"]["known_prior"])
                    and all(profile.get(k) == v for k, v in POLICY["knownPriorProfile"].items()) for m in members),
                "currentlyUnflaggedSessions": sum(all(row["traffic"] == "UNFLAGGED" for row in m["events"]) for m in members),
                "ownedBotSessions": sum(any(row["traffic"] == "BOT" for row in m["events"]) for m in members),
                "selectedSessions": sum(m["session"] in selected for m in members),
            },
        })
    cohort_evidence.sort(key=lambda value: (-value["starts"], -value["networkIdentities"],
                        tuple(str(value["browserProfile"].get(k) or "") for k in ("product", "version", "os")),
                        -value["directPercent"], -value["passivePercent"]))
    for value in sessions.values():
        if not value["inPeriod"] or "start" not in value:
            continue
        first_link = mapping.get(value["start"]["visitor"], [])
        if len(first_link) != 1:
            continue
        profile = json.loads(first_link[0]["profile"])
        mobile_family = [profile.get(k) for k in ("product", "version", "os")] in POLICY["reviewedMobileProfiles"]
        if not mobile_family and [profile.get(k) for k in ("product", "version", "os")] not in POLICY["reviewedDesktopProfiles"]:
            continue
        partition = mobile_preservation if mobile_family else preservation
        scope_start = POLICY["reviewedMobileOnset"] if mobile_family else POLICY["reviewedDesktopOnset"]
        if value["session"] in selected:
            partition["classified"] += 1
        elif value["functional"]:
            partition["functional"] += 1
        elif value["app"]:
            partition["app"] += 1
        elif at(value["start"]["at"]) < at(scope_start):
            partition["beforeOnset"] += 1
        elif mobile_family and not value["zeroEngagement"]:
            partition["positiveEngagement"] += 1
        elif not value["bounded"]:
            partition["engagementAboveBound"] += 1
        elif value["reentry"]:
            partition["reentry"] += 1
        elif not value["closed"]:
            partition["recentActivity"] += 1
        elif not value["originalUnflagged"]:
            partition["originalBotOrMixed"] += 1
        elif value["link"] is None:
            partition["ambiguousSessionIdentity"] += 1
        elif mobile_family and value["views"] == 0:
            partition["noPageView"] += 1
        elif mobile_family and value["views"] > 1:
            partition["multiplePageViews"] += 1
        elif mobile_family and not value["singleStart"]:
            partition["multipleStarts"] += 1
        elif mobile_family and value["link"]["ua_key"] not in strong_mobile:
            partition["cohortBelowThreshold"] += 1
        else:
            partition["otherSafeguard"] += 1
    return {"selected": selected, "restore": restore, "coverage": dict(coverage), "sessions": sessions,
            "strongCohorts": sum(value["strong"] for value in cohort_evidence), "cohorts": len(cohorts),
            "reviewedDesktopPartition": dict(preservation), "reviewedMobilePartition": dict(mobile_preservation),
            "cohortEvidenceSessions": sum(value["starts"] for value in cohort_evidence),
            "cohortEvidence": cohort_evidence[:COHORT_EVIDENCE_LIMIT]}


def plan_digest(analysis, cutoff):
    return digest({"policy": POLICY_DIGEST, "cutoff": stamp(cutoff),
                   "selected": sorted((session, value["reason"], [(r["id"], immutable(r), r["traffic"]) for r in value["events"]]) for session, value in analysis["selected"].items()),
                   "restore": sorted((row["id"], immutable(row)) for row in analysis["restore"])})


def same_eventset(expected, current):
    return sorted((r["id"], immutable(r), r["traffic"]) for r in expected) == sorted((r["id"], immutable(r), r["traffic"]) for r in current)


def recover(state, database, cutoff):
    """Crash recovery never assumes a prepared row reached MySQL. Read and reconcile."""
    pending = [dict(row) for row in state.execute("SELECT * FROM ledger WHERE status IN ('prepared','restore_prepared','rollback_prepared')")]
    for pos in range(0, len(pending), 20):
        chunk = pending[pos:pos + 20]
        tx = database.transaction()
        try:
            current = {r["id"]: r for r in locked_rows(tx, sorted({r["session"] for r in chunk}), cutoff)}
            for item in chunk:
                row = current.get(item["event_id"])
                if row is None:
                    status = "expired" if at(item["occurred_at"]) < cutoff - timedelta(days=POLICY["retentionDays"]) else "conflict"
                elif immutable(row) != item["fingerprint"]:
                    status = "conflict"
                elif row["traffic"] == "BOT":
                    status = "applied"
                elif row["traffic"] == "UNFLAGGED":
                    status = {"prepared": "not_applied", "restore_prepared": "restored", "rollback_prepared": "rolledback"}[item["status"]]
                else:
                    status = "conflict"
                state.execute("UPDATE ledger SET status=?,updated_at=? WHERE event_id=? AND status=?", (status, stamp(cutoff), item["event_id"], item["status"]))
            for batch in {item["batch_id"] for item in chunk}:
                statuses = {row[0] for row in state.execute("SELECT DISTINCT status FROM ledger WHERE batch_id=?", (batch,))}
                summary = next(iter(statuses)) if len(statuses) == 1 else "partial"
                state.execute("UPDATE batches SET status=? WHERE id=?", (summary, batch))
            state.commit()
        finally:
            tx.close()
    if state.execute("SELECT 1 FROM ledger WHERE status='conflict' LIMIT 1").fetchone():
        raise RuntimeError("LEDGER_RECONCILIATION_CONFLICT")


def apply_analysis(state, database, analysis, cutoff):
    """Lock/revalidate small closed-session batches, then write exact pre-ledgered IDs."""
    selected = analysis["selected"]
    restore_sessions = {row["session"] for row in analysis["restore"]}
    targets = sorted({session for session, value in selected.items() if any(r["traffic"] == "UNFLAGGED" for r in value["events"])} | restore_sessions)
    changed_dates, changed, restored, batches = set(), 0, 0, []
    for pos in range(0, len(targets), 20):
        chunk = targets[pos:pos + 20]
        tx = database.transaction()
        batch = hashlib.sha256(os.urandom(32)).hexdigest()
        try:
            current = locked_rows(tx, chunk, datetime.now(KST))
            by_session = defaultdict(list)
            for row in current:
                by_session[row["session"]].append(row)
            for session in chunk:
                if not same_eventset(analysis["sessions"][session]["events"], by_session[session]):
                    raise RuntimeError("PLAN_EVENTSET_CHANGED")
            additions = [(row, selected[session]["reason"]) for session in chunk if session in selected for row in by_session[session] if row["traffic"] == "UNFLAGGED"]
            undo = [row for row in analysis["restore"] if row["session"] in chunk]
            # Durable write-ahead commit precedes every production update.
            state.execute("INSERT INTO batches VALUES(?,?,?,?,?)", (batch, stamp(cutoff), plan_digest(analysis, cutoff), "classify", "prepared"))
            for row, reason in additions:
                old = state.execute("SELECT * FROM ledger WHERE event_id=?", (row["id"],)).fetchone()
                if old and old["status"] not in ("not_applied",):
                    raise RuntimeError("LEDGER_EVENT_ALREADY_RECORDED")
                state.execute("INSERT OR REPLACE INTO ledger VALUES(?,?,?,?,?,'UNFLAGGED',?,?,?,?)", (row["id"], batch, row["session"], row["at"], row["day"], immutable(row), reason, "prepared", stamp(cutoff)))
            for row in [r for r, _ in additions] + undo:
                state.execute("INSERT OR REPLACE INTO pending_rollups VALUES(?,?)", (row["day"], stamp(cutoff)))
                changed_dates.add(row["day"])
            for row in undo:
                state.execute("UPDATE ledger SET status='restore_prepared',updated_at=? WHERE event_id=? AND status='applied'", (stamp(cutoff), row["id"]))
            state.commit()
            if additions:
                ids = ",".join(row["id"] for row, _ in additions)
                result = tx.execute("UPDATE service_analytics_event SET traffic_class='BOT' WHERE traffic_class='UNFLAGGED' AND event_id IN (" + ids + "); SELECT ROW_COUNT()")
                if result != [str(len(additions))]:
                    raise RuntimeError("CONDITIONAL_UPDATE_COUNT_CHANGED")
            if undo:
                ids = ",".join(row["id"] for row in undo)
                result = tx.execute("UPDATE service_analytics_event SET traffic_class='UNFLAGGED' WHERE traffic_class='BOT' AND event_id IN (" + ids + "); SELECT ROW_COUNT()")
                if result != [str(len(undo))]:
                    raise RuntimeError("CONDITIONAL_RESTORE_COUNT_CHANGED")
            tx.execute("COMMIT")
            state.execute("UPDATE ledger SET status='applied',updated_at=? WHERE batch_id=? AND status='prepared'", (stamp(cutoff), batch))
            for row in undo:
                state.execute("UPDATE ledger SET status='restored',updated_at=? WHERE event_id=?", (stamp(cutoff), row["id"]))
            state.execute("UPDATE batches SET status='applied' WHERE id=?", (batch,))
            state.commit()
            changed += len(additions)
            restored += len(undo)
            batches.append(batch)
        except Exception:
            state.rollback()
            raise
        finally:
            tx.close()
    return {"newlyFlaggedEvents": changed, "restoredEvents": restored, "batchCount": len(batches), "affectedDates": sorted(changed_dates)}


def rollback_plan(state, rows, batch):
    if not re.fullmatch(r"[a-f0-9]{64}", batch):
        raise RuntimeError("INVALID_BATCH_ID")
    ledger = [dict(r) for r in state.execute("SELECT * FROM ledger WHERE batch_id=? AND status='applied'", (batch,))]
    current = {r["id"]: r for r in rows}
    selected = []
    for item in ledger:
        row = current.get(item["event_id"])
        if row is None or row["traffic"] != "BOT" or immutable(row) != item["fingerprint"]:
            raise RuntimeError("ROLLBACK_PRECONDITION_CHANGED")
        selected.append(row)
    return {"source": "automation-statistics-rollback", "status": "plan", "events": len(selected),
            "affectedDates": sorted({r["day"] for r in selected}),
            "planDigest": digest({"batch": batch, "events": sorted((r["id"], immutable(r)) for r in selected)})}, selected


def apply_rollback(state, database, rows, batch, cutoff):
    # All rollback rows belong to this classifier and were originally UNFLAGGED.
    for pos in range(0, len(rows), 20):
        chunk = rows[pos:pos + 20]
        tx = database.transaction()
        try:
            current = {r["id"]: r for r in locked_rows(tx, sorted({r["session"] for r in chunk}), cutoff)}
            if any(r["id"] not in current or current[r["id"]]["traffic"] != "BOT" or immutable(current[r["id"]]) != immutable(r) for r in chunk):
                raise RuntimeError("ROLLBACK_PRECONDITION_CHANGED")
            for row in chunk:
                state.execute("INSERT OR REPLACE INTO pending_rollups VALUES(?,?)", (row["day"], stamp(cutoff)))
                state.execute("UPDATE ledger SET status='rollback_prepared',updated_at=? WHERE event_id=? AND batch_id=? AND status='applied'", (stamp(cutoff), row["id"], batch))
            state.commit()
            result = tx.execute("UPDATE service_analytics_event SET traffic_class='UNFLAGGED' WHERE traffic_class='BOT' AND event_id IN (" + ",".join(r["id"] for r in chunk) + "); SELECT ROW_COUNT()")
            if result != [str(len(chunk))]:
                raise RuntimeError("ROLLBACK_UPDATE_COUNT_CHANGED")
            tx.execute("COMMIT")
            for row in chunk:
                state.execute("UPDATE ledger SET status='rolledback',updated_at=? WHERE event_id=? AND batch_id=? AND status='rollback_prepared'", (stamp(cutoff), row["id"], batch))
            state.commit()
        finally:
            tx.close()


def clean_state(state, rows, cutoff):
    floor = stamp(cutoff - timedelta(days=POLICY["retentionDays"]))
    state.execute("DELETE FROM mappings WHERE last_at<?", (floor,))
    available = {r["id"] for r in rows}
    for row in state.execute("SELECT event_id,occurred_at FROM ledger").fetchall():
        if at(row["occurred_at"]) < cutoff - timedelta(days=POLICY["retentionDays"]) and row["event_id"] not in available:
            state.execute("DELETE FROM ledger WHERE event_id=?", (row["event_id"],))
    state.execute("DELETE FROM batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM ledger) AND created_at<?", (floor,))
    state.commit()


def save_export(path, output):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as stream:
        json.dump(output, stream, ensure_ascii=False, separators=(",", ":"))
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o644)  # Aggregates only; private SQLite is never exposed.
    temporary.replace(path)


def report(analysis, rows, owned, cutoff, status, scan):
    floor = window_floor(cutoff)
    restored = {r["id"] for r in analysis["restore"]}
    inventory = {}
    for row in rows:
        item = owned.get(row["id"])
        if item and row["traffic"] == "BOT" and item["fingerprint"] == immutable(row) and row["id"] not in restored:
            inventory[row["id"]] = item["reason"]
    if status == "plan":
        for value in analysis["selected"].values():
            for row in value["events"]:
                inventory[row["id"]] = value["reason"]
    groups, daily = {}, defaultdict(Counter)
    group_sessions, daily_sessions = defaultdict(set), defaultdict(set)
    for row in rows:
        if not floor <= at(row["at"]) < cutoff:
            continue
        if row["id"] in inventory:
            reason = inventory[row["id"]]
            key = (row["day"], "PATTERN_INFERRED", reason)
            group = groups.setdefault(reason, {"reasonKey": reason, "classification": "PATTERN_INFERRED", "providerIdentity": "UNVERIFIED", "sessions": 0, "events": 0, "views": 0, "firstAt": stamp(at(row["at"])), "lastAt": stamp(at(row["at"]))})
            group["events"] += 1
            group["views"] += row["event"] == "page_view"
            group["firstAt"] = min(group["firstAt"], stamp(at(row["at"])))
            group["lastAt"] = max(group["lastAt"], stamp(at(row["at"])))
            if row["event"] == "session_start":
                group_sessions[reason].add(row["session"])
        elif row["traffic"] == "BOT" and row["id"] not in owned:
            key = (row["day"], "UA_SIGNAL", "UA_SIGNAL")
        else:
            continue
        daily[key]["events"] += 1
        daily[key]["views"] += row["event"] == "page_view"
        if row["event"] == "session_start":
            daily_sessions[key].add(row["session"])
    for reason, group in groups.items():
        group["sessions"] = len(group_sessions[reason])
    for key, counts in daily.items():
        counts["sessions"] = len(daily_sessions[key])
    coverage = {key: analysis["coverage"].get(key, 0) for key in ("matchedEvents", "totalEvents", "eligibleSessions", "unmatchedEvents", "ambiguousEvents")}
    classified = sum(g["sessions"] for g in groups.values())
    coverage.update(classifiedSessions=classified, flaggedEvents=sum(g["events"] for g in groups.values()))
    # originalUnflagged also permits unchanged owned BOT events for cohort stability;
    # review-only must instead describe sessions whose current events are all UNFLAGGED.
    review = [v for v in analysis["sessions"].values() if v["inPeriod"] and v["originalUnflagged"] and v["link"] and v["passive"] and v["direct"] and v["closed"] and v["session"] not in analysis["selected"]
              and all(row["traffic"] == "UNFLAGGED" for row in v["events"])]
    reported_cohort_sessions = sum(value["starts"] for value in analysis["cohortEvidence"])
    return {"schema": 1, "source": "automation-statistics", "generatedAt": stamp(cutoff), "lastCompletedAt": stamp(cutoff) if status in ("ready", "plan") else None,
            "status": status, "errorCode": None if scan["complete"] else "INCOMPLETE_LOG_SCAN",
            "period": {"from": str(floor.date()), "to": str(cutoff.date())},
            "job": {"intervalSeconds": 300, "ruleVersion": RULE_VERSION, "ledgerEnabled": True, "applyMode": "plan" if status == "plan" else "apply"},
            "coverage": coverage, "groups": list(groups.values()),
            "daily": [{"date": day, "classification": classification, "reasonKey": reason, **counts} for (day, classification, reason), counts in sorted(daily.items())],
            "reviewOnly": {"sessions": len(review), "events": sum(len(v["events"]) for v in review), "strongCohorts": analysis["strongCohorts"], "action": "PRESERVE_UNFLAGGED"},
            "policyEvidence": {
                "reviewedDesktopPartition": analysis["reviewedDesktopPartition"],
                "reviewedMobilePartition": analysis["reviewedMobilePartition"], "cohorts": analysis["cohortEvidence"],
                "cohortCount": analysis["cohorts"], "reportedCohortCount": len(analysis["cohortEvidence"]),
                "omittedCohortCount": analysis["cohorts"] - len(analysis["cohortEvidence"]),
                "cohortStartedSessions": analysis["cohortEvidenceSessions"], "reportedCohortStartedSessions": reported_cohort_sessions,
                "omittedCohortStartedSessions": analysis["cohortEvidenceSessions"] - reported_cohort_sessions,
                "cohortEvidenceLimit": COHORT_EVIDENCE_LIMIT,
                "thresholds": {key: POLICY[key] for key in ("minStarts", "minNetworks", "directPercent", "passivePercent",
                                                          "reviewedOnsetPercent", "reviewedDesktopOnset", "reviewedMobileOnset",
                                                          "mobileCohortThresholds", "mobileEngagementSeconds", "idleMinutes", "maxEngagementSeconds")},
                "definitions": {
                    "cohorts": "Started sessions inside the rolling period with one matched full-UA/network identity and no declared bot name; unchanged classifier-owned BOT sessions remain in this denominator. Separate full UAs may have identical normalized browserProfile values.",
                    "commonSafeguardSessions": "In-period original-UNFLAGGED or unchanged owned events, complete unambiguous same-UA/network matching, closed for idleMinutes, all events Direct/unattributed, no app or functional event, one start, no reentry and engagement within maxEngagementSeconds.",
                    "selection": "The desktop/mobile rules additionally require the corresponding reviewed family, its strong cohort, passive single view and a start inside that family's reviewed scope. Mobile sessions also require zero total engagement seconds; later positive time restores only mobile-owned events. reviewedMobileOnset is an individual selection floor for this follow-up review scope, not a cohort onset-ratio gate or an asserted attack start. The known-prior rule instead requires its exact network/profile and at most one view. selectedSessions includes already-owned sessions still meeting policy, not only new writes.",
                    "mobileCohort": "All matching full-UA started sessions in the seven-calendar-day population remain in the denominator, including starts before the review scope. Observed span is max minus min first-start time within that population. zeroPassive is the zero-engagement subset of passive single-view sessions, not independent evidence.",
                    "reviewOnly": "Currently all-UNFLAGGED, uniquely matched passive single-view Direct/unattributed sessions closed for idleMinutes and not selected by current policy. This subset is not all remaining visitors; the engagement bound is not required. Already-BOT sessions are excluded.",
                    "classifiedSessions": "Distinct sessions with classifier-owned BOT start events in the advertised period; plan mode additionally includes proposed classifications. This is actual/proposed inventory, not the current policy-eligibility count.",
                },
            },
            "lastRun": {"newlyClassifiedSessions": sum(any(r["traffic"] == "UNFLAGGED" for r in value["events"]) for value in analysis["selected"].values()), "newlyFlaggedEvents": sum(r["traffic"] == "UNFLAGGED" for value in analysis["selected"].values() for r in value["events"]), "restoredEvents": len(restored)},
            "affectedDates": sorted({r["day"] for v in analysis["selected"].values() for r in v["events"] if r["traffic"] == "UNFLAGGED"} | {r["day"] for r in analysis["restore"]}),
            "rollup": {"status": "PENDING_EXISTING_BATCH_REFRESH" if any(r["traffic"] == "UNFLAGGED" for v in analysis["selected"].values() for r in v["events"]) or restored else "UNCHANGED"},
            "planDigest": plan_digest(analysis, cutoff), "policyDigest": POLICY_DIGEST, "scan": scan,
            "limitations": ["Pattern inference does not authenticate an operator or establish malicious intent.", "Source matching links monthly network/full-UA cohorts, not a person or one-to-one HTTP request.", "Unreviewed profiles remain review-only; the reviewed desktop/mobile families and historical exact network require joint behavioral evidence.", "The mobile rule is a review candidate; its scope start is not an asserted attack onset."]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--state", default="/var/lib/geupddong-analytics-classifier/private.sqlite")
    parser.add_argument("--parser", default=str(Path(__file__).with_name("origin_parser.py")))
    parser.add_argument("--log", action="append", default=[])
    parser.add_argument("--cutoff")
    parser.add_argument("--scan-seconds", type=int, default=50)
    parser.add_argument("--apply-approved", action="store_true")
    parser.add_argument("--approve-plan")
    parser.add_argument("--expected-policy")
    parser.add_argument("--rollback-batch")
    parser.add_argument("--export")
    args = parser.parse_args(argv)
    mutable = args.apply or args.run
    if mutable and not args.apply_approved:
        raise RuntimeError("EXPLICIT_APPLY_FLAG_REQUIRED")
    if args.run and (args.expected_policy != POLICY_DIGEST or args.rollback_batch):
        raise RuntimeError("APPROVED_POLICY_DIGEST_REQUIRED")
    if args.apply and (not args.cutoff or not args.approve_plan):
        raise RuntimeError("FIXED_CUTOFF_AND_PLAN_DIGEST_REQUIRED")
    if args.expected_policy and args.expected_policy != POLICY_DIGEST:
        raise RuntimeError("POLICY_DIGEST_CHANGED")
    if not 1 <= args.scan_seconds <= 90:
        raise RuntimeError("INVALID_SCAN_BUDGET")
    os.umask(0o077)
    lock = None
    if mutable:
        Path(args.state).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock = open(str(args.state) + ".lock", "a")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("JOB_ALREADY_RUNNING")
    state = None
    try:
        db = Database()
        cutoff = at(args.cutoff) if args.cutoff else at(db.select("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 9 HOUR),'%Y-%m-%d %H:%i:%s.%f')").strip())
        state = open_state(args.state, readonly=not mutable)
        key_id = hmac.new(db.key, b"stats-classifier-key-version", hashlib.sha256).hexdigest()
        previous_key = state.execute("SELECT value FROM meta WHERE key='identity_key'").fetchone()
        if previous_key and previous_key[0] != key_id:
            raise RuntimeError("ANALYTICS_IDENTITY_KEY_CHANGED")
        state.execute("INSERT OR REPLACE INTO meta VALUES('identity_key',?)", (key_id,))
        state.commit()
        if mutable:
            recover(state, db, cutoff)
            refresh_pending_rollups(state, db, cutoff)
        rows = db.rows(cutoff)
        if args.rollback_batch:
            output, undo = rollback_plan(state, rows, args.rollback_batch)
            if mutable:
                if output["planDigest"] != args.approve_plan:
                    raise RuntimeError("PLAN_DIGEST_CHANGED")
                apply_rollback(state, db, undo, args.rollback_batch, cutoff)
                output["status"] = "ready"
                refresh_pending_rollups(state, db, cutoff)
            print(canonical(output))
            return
        scan = scan_logs(state, args.log or list(Path("/var/log/nginx").glob("access.log*")), db.key, load_parser(args.parser), cutoff, args.scan_seconds)
        owned = owned_ledger(state)
        suppressed = {row[0] for row in state.execute("SELECT event_id FROM ledger WHERE status IN ('rolledback','restored')")}
        analysis = analyze(rows, mappings(state), owned, cutoff, suppressed)
        preview = report(analysis, rows, owned, cutoff, "plan" if scan["complete"] else "partial", scan)
        output = preview
        if mutable:
            if not scan["complete"]:
                raise RuntimeError("INCOMPLETE_LOG_SCAN")
            if args.apply and args.approve_plan != preview["planDigest"]:
                raise RuntimeError("PLAN_DIGEST_CHANGED")
            changes = apply_analysis(state, db, analysis, cutoff)
            rollup = refresh_pending_rollups(state, db, cutoff)
            after = db.rows(cutoff)
            fresh_owned = owned_ledger(state)
            current = analyze(after, mappings(state), fresh_owned, cutoff, suppressed)
            output = report(current, after, fresh_owned, cutoff, "ready", scan)
            output["lastRun"] = {**preview["lastRun"], **{k: v for k, v in changes.items() if k != "affectedDates"}}
            output["affectedDates"] = changes["affectedDates"]
            output["rollup"] = rollup
            output["needsRollupRefresh"] = bool(state.execute("SELECT 1 FROM pending_rollups LIMIT 1").fetchone())
            output["job"]["applyMode"] = "run" if args.run else "apply"
            clean_state(state, after, cutoff)
            if args.export:
                save_export(args.export, output)
        print(canonical(output))
    except Exception as error:
        if mutable and args.export:
            try:
                old = json.loads(Path(args.export).read_text()) if Path(args.export).exists() else {}
                if old.get("source") == "automation-statistics":
                    old.update(status="error", generatedAt=stamp(datetime.now(KST)), errorCode=str(error) if re.fullmatch(r"[A-Z_]+", str(error)) else type(error).__name__)
                    save_export(args.export, old)
            except Exception:
                pass
        raise
    finally:
        if state is not None:
            state.close()
        if lock is not None:
            lock.close()


def refresh_pending_rollups(state, database, cutoff):
    pending = [row[0] for row in state.execute("SELECT day FROM pending_rollups ORDER BY day")]
    if not pending:
        return {"status": "UNCHANGED", "dates": []}
    from refresh_rollups import refresh
    result = refresh(database, pending, datetime.now(KST), apply=True)
    state.execute("DELETE FROM pending_rollups WHERE day IN (" + ",".join("?" for _ in pending) + ")", pending)
    state.commit()
    return {"status": "REFRESHED", "dates": result["dates"]}


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"source": "automation-statistics", "status": "error", "errorCode": str(error) if re.fullmatch(r"[A-Z_]+", str(error)) else type(error).__name__}), file=sys.stderr)
        sys.exit(1)
