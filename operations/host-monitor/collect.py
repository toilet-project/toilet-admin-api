#!/usr/bin/env python3
"""Host-only, unprivileged Linux collector. No Docker socket or database credentials.

One timer tick produces one sample. Counter intervals exceeding 90s are unknown.
Only numeric operational summaries leave the private SQLite store.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.request

KST = timezone(timedelta(hours=9))
METRICS = ("cpuPercent", "memoryPercent", "swapPercent", "diskPercent", "inodePercent",
           "ioWaitPercent", "memoryPressurePercent", "ioPressurePercent", "rxMbps", "txMbps",
           "rxUtilPercent", "txUtilPercent", "internetLatencyMs", "apiLatencyMs")


def read(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def number(path):
    try:
        return int(read(path))
    except (TypeError, ValueError):
        return None


def meminfo(text):
    return {key: int(value.split()[0]) * 1024 for key, value in
            (line.split(":", 1) for line in text.splitlines())}


def percent(used, total):
    return round(used * 100 / total, 2) if total and used is not None else None


def pressure(path):
    text = read(path) or ""
    match = re.search(r"^some .*?avg60=([\d.]+)", text, re.M)
    return float(match[1]) if match else None


def interface_name():
    routes = (read("/proc/net/route") or "").splitlines()[1:]
    choices = [r.split() for r in routes if len(r.split()) >= 8
               and r.split()[1] == "00000000" and int(r.split()[3], 16) & 1]
    return min(choices, key=lambda r: int(r[6]))[0] if choices else None


def probe(url, health=False):
    # Fixed destinations; ignore response bodies except a bounded minimal health response.
    start = time.monotonic()
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "GeupddongHostMonitor/1"})
        with urllib.request.urlopen(request, timeout=3) as response:
            ok = response.status == 200
            if health:
                ok = ok and json.loads(response.read(4096)).get("status") == "UP"
        return {"ok": ok, "latencyMs": round((time.monotonic() - start) * 1000, 1) if ok else None}
    except Exception:
        return {"ok": False, "latencyMs": None}


def snapshot(config, probes=True):
    stat = read("/proc/stat")
    memory = read("/proc/meminfo")
    if not stat or not memory:
        raise RuntimeError("Linux host counters unavailable")
    memory = meminfo(memory)
    cpu = list(map(int, stat.splitlines()[0].split()[1:9]))
    iface = config.get("interface") or interface_name()
    if iface and not re.fullmatch(r"[A-Za-z0-9_.:-]{1,32}", iface):
        raise ValueError("invalid interface")
    net = Path("/sys/class/net") / (iface or "unavailable")
    counters = {key: number(net / "statistics" / key) for key in
                ("rx_bytes", "tx_bytes", "rx_errors", "tx_errors", "rx_dropped", "tx_dropped")}
    disk_path = config.get("diskPath", "/")
    fs = os.statvfs(disk_path)
    total, available = fs.f_blocks * fs.f_frsize, fs.f_bavail * fs.f_frsize
    used = (fs.f_blocks - fs.f_bfree) * fs.f_frsize
    swap_total = memory.get("SwapTotal", 0)
    swap_used = swap_total - memory.get("SwapFree", 0)
    speed = number(net / "speed")
    capacities = {key: config.get(key) for key in ("downloadMbps", "uploadMbps")}
    for value in capacities.values():
        if value is not None and (not isinstance(value, (int, float)) or not 0 < value <= 100000):
            raise ValueError("invalid configured network capacity")
    result = {
        "ts": time.time(), "monotonic": time.monotonic(), "boot": read("/proc/sys/kernel/random/boot_id"),
        "cpu": cpu, "counters": counters, "ifindex": number(net / "ifindex"), "interface": iface,
        "cpuCores": sum(1 for line in stat.splitlines() if re.match(r"cpu\d+ ", line)),
        "memoryTotalBytes": memory["MemTotal"], "memoryAvailableBytes": memory.get("MemAvailable"),
        "memoryPercent": percent(memory["MemTotal"] - memory["MemAvailable"], memory["MemTotal"])
                          if "MemAvailable" in memory else None,
        "swapUsedBytes": swap_used, "swapTotalBytes": swap_total,
        "swapPercent": percent(swap_used, swap_total), "diskTotalBytes": total,
        "diskAvailableBytes": available, "diskPercent": percent(used, used + available),
        "inodePercent": percent(fs.f_files - fs.f_favail, fs.f_files),
        "memoryPressurePercent": pressure("/proc/pressure/memory"),
        "ioPressurePercent": pressure("/proc/pressure/io"),
        "linkUp": {"1": True, "0": False}.get(read(net / "carrier")),
        "linkSpeedMbps": speed if speed and speed > 0 else None,
        "downloadMbps": capacities["downloadMbps"], "uploadMbps": capacities["uploadMbps"],
    }
    if probes:
        with ThreadPoolExecutor(max_workers=2) as pool:
            internet = pool.submit(probe, "https://geupddong.com/version.json")
            api = pool.submit(probe, "https://api.geupddong.com/api/health", True)
            for key, future in (("internet", internet), ("api", api)):
                value = future.result()
                result[key + "Ok"] = value["ok"]
                result[key + "LatencyMs"] = value["latencyMs"]
    return result


def derive(current, previous):
    # Never count the guest fields twice or count Linux's reclaimable cache as exhausted RAM.
    result = {k: v for k, v in current.items() if k not in ("boot", "monotonic", "cpu", "counters", "ifindex")}
    result.update({k: None for k in ("cpuPercent", "ioWaitPercent", "rxMbps", "txMbps", "rxBytes", "txBytes",
                                     "rxUtilPercent", "txUtilPercent", "networkErrors", "networkDrops")})
    result["intervalSeconds"] = 0
    if not previous or not current.get("boot") or previous["boot"] != current["boot"]:
        return result
    elapsed = current["monotonic"] - previous["monotonic"]
    wall_elapsed = current["ts"] - previous["ts"]
    if not 1 <= elapsed <= 90 or abs(wall_elapsed - elapsed) > 5:
        return result
    result["intervalSeconds"] = round(elapsed, 3)
    delta = [a - b for a, b in zip(current["cpu"], previous["cpu"])]
    if len(delta) == 8 and min(delta) >= 0 and sum(delta) > 0:
        result["cpuPercent"] = percent(sum(delta) - delta[3] - delta[4], sum(delta))
        result["ioWaitPercent"] = percent(delta[4], sum(delta))
    if current["interface"] != previous["interface"] or current["ifindex"] != previous["ifindex"]:
        return result
    a, b = current["counters"], previous["counters"]
    def diff(key):
        return a[key] - b[key] if a.get(key) is not None and b.get(key) is not None and a[key] >= b[key] else None
    for direction, capacity in (("rx", "downloadMbps"), ("tx", "uploadMbps")):
        value = diff(direction + "_bytes")
        result[direction + "Bytes"] = value
        rate = value * 8 / elapsed / 1e6 if value is not None else None
        result[direction + "Mbps"] = round(rate, 3) if rate is not None else None
        result[direction + "UtilPercent"] = percent(rate, current.get(capacity))
    for output, names in (("networkErrors", ("rx_errors", "tx_errors")), ("networkDrops", ("rx_dropped", "tx_dropped"))):
        values = [diff(k) for k in names]
        result[output] = sum(values) if all(v is not None for v in values) else None
    return result


def day_bounds(day):
    start = datetime.fromisoformat(day).replace(tzinfo=KST).timestamp()
    return start, start + 86400


def stats(samples, key, start, end):
    # Interval-weighted statistics; gaps and midnight portions are never filled with invented values.
    values = []
    for sample in samples:
        duration = sample["intervalSeconds"]
        weight = max(0, min(end, sample["ts"]) - max(start, sample["ts"] - duration))
        value = sample.get(key)
        if value is not None and weight > 0:
            values.append((value, weight))
    if not values:
        return {"avg": None, "max": None, "p95": None, "above80Minutes": 0, "observedMinutes": 0}
    weight_sum = sum(w for _, w in values)
    cumulative, p95 = 0, None
    for value, weight in sorted(values):
        cumulative += weight
        if cumulative >= weight_sum * .95:
            p95 = value
            break
    return {"avg": round(sum(v * w for v, w in values) / weight_sum, 2),
            "max": max(v for v, _ in values), "p95": p95,
            "above80Minutes": round(sum(w for v, w in values if v >= 80) / 60, 1),
            "observedMinutes": round(weight_sum / 60, 1)}


def aggregate(samples, day, now):
    start, end = day_bounds(day)
    end = min(end, now)
    measured = sum(max(0, min(end, s["ts"]) - max(start, s["ts"] - s["intervalSeconds"])) for s in samples)
    relevant = [s for s in samples if start <= s["ts"] < end + .001]
    result = {"date": day, "sampleCount": len(relevant), "observedMinutes": round(measured / 60, 1),
              "coveragePercent": round(min(100, measured / max(1, end - start) * 100), 1),
              "metrics": {key: stats(samples, key, start, end) for key in METRICS}}
    for key in ("rxBytes", "txBytes", "networkErrors", "networkDrops"):
        parts = [(s[key] * max(0, min(end, s["ts"]) - max(start, s["ts"] - s["intervalSeconds"])) / s["intervalSeconds"])
                 for s in samples if s.get(key) is not None and s["intervalSeconds"] > 0]
        result[key] = round(sum(parts)) if parts else None
    for key in ("internet", "api"):
        tested = [s for s in relevant if s.get(key + "Ok") is not None]
        result[key + "Checks"] = len(tested)
        result[key + "Failures"] = sum(s[key + "Ok"] is False for s in tested)
    return result


def assessment(samples):
    if not samples:
        return {"level": "UNKNOWN", "messages": ["수집을 기다리고 있습니다."]}
    latest = samples[-1]
    warnings = []
    def sustained(key):
        seconds, next_start = 0, latest["ts"]
        for sample in reversed(samples):
            if abs(next_start - sample["ts"]) > 5 or sample.get(key) is None or sample[key] < 80 or not sample["intervalSeconds"]:
                break
            seconds += sample["intervalSeconds"]
            next_start = sample["ts"] - sample["intervalSeconds"]
        return seconds >= 900
    for key, message in (("cpuPercent", "CPU 80% 이상이 15분 지속됐습니다. 배치·느린 처리 원인을 확인하고 CPU 증설이나 작업 분산을 검토하세요."),
                         ("memoryPercent", "메모리 80% 이상이 15분 지속됐습니다. 스왑·메모리 압력과 함께 보고 메모리 증설을 검토하세요."),
                         ("rxUtilPercent", "수신량이 설정한 회선 기준의 80% 이상으로 15분 지속됐습니다. LAN 전송 여부와 회선 병목을 확인하세요."),
                         ("txUtilPercent", "송신량이 설정한 회선 기준의 80% 이상으로 15분 지속됐습니다. 백업·LAN 전송 여부와 업로드 회선을 확인하세요.")):
        if sustained(key):
            warnings.append(message)
    critical = any((latest.get(k) or 0) >= 90 for k in ("diskPercent", "inodePercent"))
    if critical:
        warnings.append("디스크 또는 파일 개수 한도가 90% 이상입니다. 여유 공간·보관 정책을 먼저 확인하세요.")
    if (latest.get("memoryPressurePercent") or 0) >= 10 or (latest.get("ioPressurePercent") or 0) >= 10:
        warnings.append("메모리 또는 디스크 대기가 관측됐습니다. 응답 지연과 작업 부하를 함께 확인하세요.")
    if latest.get("linkUp") is False or latest.get("internetOk") is False or latest.get("apiOk") is False:
        warnings.append("통신 점검이 실패했습니다. 공유기·Tunnel·API 상태를 확인하세요. 이것만으로 회선 전체 장애를 단정하지 않습니다.")
    if warnings:
        return {"level": "CRITICAL" if critical else "WARN", "messages": warnings}
    if latest.get("cpuPercent") is None or latest.get("memoryPercent") is None:
        return {"level": "UNKNOWN", "messages": ["연속된 측정값이 부족합니다. 다음 수집을 기다려 주세요."]}
    if any((latest.get(k) or 0) >= 80 for k in ("cpuPercent", "memoryPercent", "diskPercent", "rxUtilPercent", "txUtilPercent")):
        return {"level": "WATCH", "messages": ["80% 이상인 지표가 있습니다. 순간 부하인지 일별 추이와 지속 시간을 확인하세요."]}
    return {"level": "OK", "messages": ["최근 관측에서 지속적인 자원 부족 징후가 없습니다. 일별 최대·P95·수집률을 함께 확인하세요."]}


def atomic_json(path, data):
    temporary = path.with_suffix(".tmp")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    with temporary.open("w", encoding="utf-8") as output:
        output.write(payload)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o640)
    os.replace(temporary, path)


def persist(root, current):
    root.mkdir(parents=True, exist_ok=True, mode=0o750)
    exports = root / "exports"
    exports.mkdir(exist_ok=True, mode=0o750)
    with closing(sqlite3.connect(root / "metrics.sqlite", timeout=2)) as db:
        db.execute("PRAGMA auto_vacuum=INCREMENTAL")
        db.execute("CREATE TABLE IF NOT EXISTS samples(ts REAL PRIMARY KEY, raw TEXT NOT NULL, sample TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY, summary TEXT NOT NULL)")
        prior = db.execute("SELECT raw FROM samples ORDER BY ts DESC LIMIT 1").fetchone()
        previous = json.loads(prior[0]) if prior else None
        if previous and current["ts"] <= previous["ts"]:
            return  # Clock reversal: keep prior data and let the freshness check report it.
        value = derive(current, previous)
        db.execute("INSERT INTO samples VALUES(?,?,?)", (current["ts"], json.dumps(current), json.dumps(value)))
        today = datetime.fromtimestamp(current["ts"], KST).date()
        # Include intervals ending just after midnight in the previous day's weighted totals.
        for day in (today - timedelta(days=1), today):
            start, end = day_bounds(day.isoformat())
            rows = [json.loads(r[0]) for r in db.execute("SELECT sample FROM samples WHERE ts>=? AND ts<=? ORDER BY ts", (start, end + 90))]
            if rows:
                summary = aggregate(rows, day.isoformat(), current["ts"])
                db.execute("INSERT OR REPLACE INTO days VALUES(?,?)", (day.isoformat(), json.dumps(summary)))
                atomic_json(exports / (day.isoformat() + ".json"), {"schema": 1, "date": day.isoformat(),
                            "samples": [r for r in rows if start <= r["ts"] < end]})
        db.execute("DELETE FROM samples WHERE ts<?", (current["ts"] - 30 * 86400,))
        db.execute("DELETE FROM days WHERE day<?", ((today - timedelta(days=364)).isoformat(),))
        db.commit()
        db.execute("PRAGMA incremental_vacuum(128)")
        days = [json.loads(r[0]) for r in db.execute("SELECT summary FROM days ORDER BY day")]
        recent = [json.loads(r[0]) for r in db.execute("SELECT sample FROM samples WHERE ts>=? ORDER BY ts", (current["ts"] - 1800,))]
        atomic_json(exports / "summary.json", {"schema": 1, "samplePeriodSeconds": 60,
                    "sampleRetentionDays": 30, "dailyRetentionDays": 365,
                    "generatedAt": datetime.fromtimestamp(current["ts"], timezone.utc).isoformat(),
                    "latest": value, "assessment": assessment(recent), "days": days})
    for path in exports.glob("????-??-??.json"):
        if path.stem < (today - timedelta(days=29)).isoformat():
            path.unlink()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path)
    parser.add_argument("--state-dir", type=Path, default=Path("/var/snap/docker/common/geupddong-host-monitor"))
    parser.add_argument("--once-stdout", action="store_true", help="Read-only sample; creates no files or timer")
    parser.add_argument("--no-probes", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text()) if args.config else {}
    os.umask(0o027)
    if args.once_stdout:
        first = snapshot(config, probes=False)
        time.sleep(1)
        print(json.dumps(derive(snapshot(config, probes=not args.no_probes), first), ensure_ascii=False))
        return
    import fcntl  # systemd runs on the host, never inside the admin container.
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o750)
    with (args.state_dir / "collector.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        persist(args.state_dir, snapshot(config, probes=not args.no_probes))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not log addresses, responses or operational paths.
        print("Host monitor collection failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(1)
