#!/usr/bin/env python3
"""Plan evidence-backed Other bot splits offline; apply only a reviewed, unchanged plan.

Reads only already-consumed log bytes. Raw IPs, UAs and URLs never leave memory.
No network calls, official-IP retroverification, new requests or cursor resets.
"""
import argparse
from collections import Counter
from contextlib import contextmanager
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

import collect as c

NAMES = {name for _, name, _ in c.ADDITIONAL_BOTS}
TABLES = {"hits": "day,hour,bot,verification,path,status,count,first,last",
          "cursor": "id,offset", "meta": "key,value"}


@contextmanager
def readonly(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Regular existing database required")
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        yield db
    finally:
        db.close()


@contextmanager
def writable(path):
    db = sqlite3.connect(path, timeout=1)
    try:
        with db:
            yield db
    finally:
        db.close()


def fingerprint(db):
    digest = hashlib.sha256()
    for table, columns in TABLES.items():
        digest.update(table.encode())
        for row in db.execute(f"SELECT {columns} FROM {table} ORDER BY {columns}"):
            digest.update(json.dumps(row, separators=(",", ":")).encode())
    return digest.hexdigest()


def invariant(db):
    # Bot names may change; request totals, error classes, timestamps and identity
    # states must stay identical for every hour/path/status group.
    return db.execute("""SELECT day,hour,verification,path,status,SUM(count),MIN(first),MAX(last)
        FROM hits GROUP BY day,hour,verification,path,status ORDER BY day,hour,verification,path,status""").fetchall()


def add(stats, key, first, last, count=1):
    old = stats.get(key)
    stats[key] = (old[0] + count, min(old[1], first), max(old[2], last)) if old else (count, first, last)


def plan(database, logs, output, now, *, seconds=300):
    if output.exists():
        raise ValueError("Plan output must be a new directory")
    output.mkdir(mode=0o700, parents=True)
    with readonly(database) as source, writable(output / "candidate.sqlite") as db:
        source.backup(db)
        before = fingerprint(db)
        unchanged = invariant(db)
        originals = {row[:6]: row[6:] for row in db.execute(
            "SELECT day,hour,bot,verification,path,status,count,first,last FROM hits WHERE bot='Other bot' AND verification='declared'")}
        cursors = dict(db.execute("SELECT id,offset FROM cursor"))
        observed, partitions, seen = {}, {}, set()
        processed = malformed = 0
        started = time.monotonic()
        verifier = c.Verifier({}, now, False)
        for path in logs:
            if path.is_symlink() or not path.is_file():
                raise ValueError("Regular retained log required")
            with path.open("rb") as stream:
                stat = os.fstat(stream.fileno())
                identity = f"{stat.st_dev}:{stat.st_ino}"
                if identity not in cursors or identity in seen:
                    continue
                seen.add(identity)
                stop = cursors[identity]
                if stop > stat.st_size:
                    raise ValueError("Consumed log bytes are no longer retained")
                while stream.tell() < stop:
                    if time.monotonic() - started > seconds:
                        raise ValueError("Plan time budget exceeded; no operational data changed")
                    raw = stream.readline(65537)
                    if not raw or stream.tell() > stop or len(raw) > 65536 or not raw.endswith(b"\n"):
                        raise ValueError("Consumed log boundary is incomplete or oversized")
                    processed += 1
                    match = c.LINE.fullmatch(raw.decode("utf-8", errors="replace").rstrip("\r\n"))
                    if not match:
                        malformed += 1
                        continue
                    ua = match.group(5)
                    # A newly recognized UA that was never counted as a bot is
                    # deliberately excluded: backfill splits existing hits only.
                    if c.identify(ua, additional=False)[0] != "Other bot":
                        continue
                    valid, values = c.parse_record(raw, verifier, now)
                    if not valid:
                        malformed += 1
                    if not values:
                        continue
                    day, hour, name, verification, route, status, first, last = values
                    key = (day, hour, "Other bot", "declared", route, status)
                    if key not in originals:
                        continue
                    add(observed, key, first, last)
                    add(partitions, (key, name), first, last)
        moved, by_day = Counter(), Counter()
        matched = skipped = 0
        for key, original in originals.items():
            splits = {name: stats for (source_key, name), stats in partitions.items() if source_key == key}
            if not any(name in NAMES for name in splits):
                continue
            # Counts AND endpoints must reconcile exactly. Missing, rotated or
            # previously reclassified evidence cannot be guessed or subtracted.
            if observed.get(key) != original:
                skipped += 1
                continue
            matched += 1
            db.execute("DELETE FROM hits WHERE day=? AND hour=? AND bot=? AND verification=? AND path=? AND status=?", key)
            for name, (count, first, last) in splits.items():
                values = (*key[:2], name, *key[3:], count, first, last)
                db.execute("""INSERT INTO hits VALUES(?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(day,hour,bot,verification,path,status) DO UPDATE SET
                    count=count+excluded.count,first=MIN(first,excluded.first),last=MAX(last,excluded.last)""", values)
                if name in NAMES:
                    moved[name] += count
                    by_day[(key[0], name)] += count
        if invariant(db) != unchanged:
            raise ValueError("Request totals or identity states changed")
        db.commit()
        result = {"schema": 1, "sourceFingerprint": before, "candidateFingerprint": fingerprint(db),
                  "at": c.stamp(now), "processed": processed, "malformed": malformed,
                  "matchedBuckets": matched, "skippedBuckets": skipped,
                  "missingLogCursors": len(set(cursors) - seen), "reclassified": dict(moved),
                  "byDay": [{"day": day, "bot": name, "count": count}
                            for (day, name), count in sorted(by_day.items())],
                  "totalRequests": sum(row[5] for row in unchanged),
                  "totalsPreserved": True, "operationalDataChanged": False}
        # Preview data is aggregate-only and is never the operational export.
        c.atomic_json(output / "origin-bots.json", c.export(db, now, {"backlog": False, "malformed": malformed}))
        c.atomic_json(output / "plan.json", result)
        return result


def apply(database, output, export_directory, *, approved=False):
    if not approved:
        raise ValueError("Reviewed production approval required")
    import fcntl
    result = json.loads((output / "plan.json").read_text())
    if result.get("schema") != 1:
        raise ValueError("Unsupported plan")
    if not (export_directory / "origin-bots.json").is_file():
        raise ValueError("Existing export required")
    # Same lock as the collector; callers also stop the timer during rollout.
    with (database.parent / "collector.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with readonly(output / "candidate.sqlite") as candidate, writable(database) as db:
            db.execute("BEGIN IMMEDIATE")
            if fingerprint(candidate) != result["candidateFingerprint"] or fingerprint(db) != result["sourceFingerprint"]:
                raise ValueError("Plan or live state changed; regenerate the plan")
            if invariant(candidate) != invariant(db):
                raise ValueError("Request totals or identity states changed")
            # The SQLite backup is local, private and aggregate-only.
            backup_path = output / "before.sqlite"
            if backup_path.exists():
                raise ValueError("This plan already has an apply backup")
            with readonly(database) as source, writable(backup_path) as backup:
                source.backup(backup)
            db.execute("DELETE FROM hits")
            db.executemany("INSERT INTO hits VALUES(?,?,?,?,?,?,?,?,?)", candidate.execute("SELECT * FROM hits"))
            if fingerprint(db) != result["candidateFingerprint"]:
                raise ValueError("Applied state differs from reviewed plan")
            db.commit()
            # Keep files readable by the same service account after atomic replace.
            destination = export_directory / "origin-bots.json"
            permissions = destination.stat()
            data = c.export(db, dt.datetime.now(c.UTC), {"backlog": True, "malformed": 0})
            c.atomic_json(destination, data)
            if os.geteuid() == 0:
                os.chown(destination, permissions.st_uid, permissions.st_gid)
            os.chmod(destination, permissions.st_mode & 0o777)
    receipt = {"status": "applied", "reclassified": result["reclassified"],
               "totalsPreserved": True, "cursorChanged": False}
    c.atomic_json(output / "receipt.json", receipt)
    return receipt


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("plan", "apply"))
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--log", type=Path, action="append", default=[])
    parser.add_argument("--export", type=Path)
    parser.add_argument("--apply-approved", action="store_true")
    args = parser.parse_args()
    if args.operation == "plan":
        if not args.log:
            parser.error("Retained log required")
        result = plan(args.database, args.log, args.output, dt.datetime.now(c.UTC))
    else:
        if args.export is None:
            parser.error("Existing export directory required")
        result = apply(args.database, args.output, args.export, approved=args.apply_approved)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
