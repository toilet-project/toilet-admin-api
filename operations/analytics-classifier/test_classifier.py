import copy
from datetime import timedelta
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import classifier as c


NOW = c.at("2026-11-20T16:22:14.573622+09:00")
PROFILE = {"product": "Chrome", "version": "120.0.0.0", "os": "Windows", "app": None, "declaredBot": None}


def fixture(n=20, profile=None):
    rows, mapping = [], {}
    for i in range(n):
        visitor, session = f"{i+1:064X}", f"{i+1000:064X}"
        link = {"visitor": visitor, "ua_key": "UA", "network_key": "NET" + str(i),
                "profile": c.canonical(profile or PROFILE), "known_prior": 0}
        mapping[visitor] = [link]
        for j, event in enumerate(("session_start", "page_view")):
            rows.append({"id": str(i * 10 + j + 1), "session": session, "visitor": visitor,
                         "at": "2026-11-20 12:00:00.000000", "day": "2026-11-20", "event": event,
                         "traffic": "UNFLAGGED", "source": "none", "channel": "Direct", "client": "BROWSER",
                         "navigation": "NEW", "engagement": 0})
    return rows, mapping


def own(rows, state=None, reason="DISTRIBUTED_PASSIVE_PROFILE", status="applied"):
    result = {}
    for row in rows:
        row["traffic"] = "BOT"
        result[row["id"]] = {"event_id": row["id"], "session": row["session"], "fingerprint": c.immutable(row), "reason": reason, "status": status}
        if state is not None:
            state.execute("INSERT INTO ledger VALUES(?,?,?,?,?,'UNFLAGGED',?,?,?,?)",
                          (row["id"], "a" * 64, row["session"], row["at"], row["day"], c.immutable(row), reason, status, c.stamp(NOW)))
    if state:
        state.commit()
    return result


class PolicyTest(unittest.TestCase):
    def analyze(self, rows, mapping, owned=None):
        return c.analyze(rows, mapping, owned or {}, NOW)

    def test_reviewed_distributed_passive_family(self):
        rows, mapping = fixture()
        result = self.analyze(rows, mapping)
        self.assertEqual(20, len(result["selected"]))
        self.assertEqual(1, result["strongCohorts"])

    def test_no_single_signal_is_sufficient(self):
        rows, mapping = fixture(19)
        self.assertFalse(self.analyze(rows, mapping)["selected"])
        rows, mapping = fixture()
        for value in mapping.values():
            value[0]["network_key"] = "ONE"
        self.assertFalse(self.analyze(rows, mapping)["selected"])
        rows, mapping = fixture(profile={**PROFILE, "version": "147.0.0.0", "os": "Android"})
        self.assertFalse(self.analyze(rows, mapping)["selected"])

    def test_functional_and_app_sessions_preserved_inside_strong_cohort(self):
        rows, mapping = fixture()
        rows[1]["event"] = "toilet_search"
        for row in rows[2:4]:
            row["client"] = "KAKAOTALK"
        result = self.analyze(rows, mapping)
        self.assertEqual(18, len(result["selected"]))
        self.assertNotIn(rows[0]["session"], result["selected"])
        self.assertNotIn(rows[2]["session"], result["selected"])

    def test_direct_and_passivity_ratios_are_global(self):
        rows, mapping = fixture()
        rows[0]["source"] = "google"
        self.assertEqual(19, len(self.analyze(rows, mapping)["selected"]))
        rows[2]["source"] = "google"
        self.assertFalse(self.analyze(rows, mapping)["selected"])
        rows, mapping = fixture()
        for pos in (1, 3, 5):
            rows[pos]["event"] = "toilet_search"
        self.assertFalse(self.analyze(rows, mapping)["selected"])

    def test_engagement_idle_reentry_and_early_visits(self):
        rows, mapping = fixture(25)
        rows[0]["engagement"] = 31
        rows[2]["at"] = c.stamp(NOW - timedelta(minutes=34))
        rows[4]["navigation"] = "RELOAD"
        rows[6]["at"] = "2026-11-18 12:00:00.000000"
        result = self.analyze(rows, mapping)
        self.assertEqual(21, len(result["selected"]))
        for pos in (0, 2, 4, 6):
            self.assertNotIn(rows[pos]["session"], result["selected"])

    def test_known_prior_profile_no_page_view_requires_exact_network(self):
        rows, mapping = fixture(1, {**PROFILE, "version": "145.0.0.0", "os": "Linux"})
        rows = rows[:1]
        self.assertFalse(self.analyze(rows, mapping)["selected"])
        mapping[rows[0]["visitor"]][0]["known_prior"] = 1
        result = self.analyze(rows, mapping)
        self.assertEqual("KNOWN_BULK_CLIENT", next(iter(result["selected"].values()))["reason"])

    def test_unknown_ambiguous_and_original_bot_preserved(self):
        rows, mapping = fixture(23)
        mapping.pop(rows[0]["visitor"])
        mapping[rows[2]["visitor"]].append({**mapping[rows[2]["visitor"]][0], "network_key": "AMBIGUOUS"})
        rows[4]["traffic"] = "BOT"
        result = self.analyze(rows, mapping)
        self.assertEqual(20, len(result["selected"]))
        self.assertEqual(2, result["coverage"]["unmatchedEvents"])
        self.assertEqual(2, result["coverage"]["ambiguousEvents"])

    def test_own_prior_bot_keeps_future_cohort_eligible(self):
        rows, mapping = fixture(21)
        owned = own(rows[:40])
        result = self.analyze(rows, mapping, owned)
        self.assertEqual(21, len(result["selected"]))
        self.assertEqual(0, c.apply_analysis(c.open_state(), None, self.analyze(rows[:40], mapping, owned), NOW)["batchCount"])

    def test_cross_day_and_older_owned_sessions_restore(self):
        rows, mapping = fixture(1)
        rows[0]["at"] = "2026-11-10 23:58:00.000000"
        rows[1]["at"] = "2026-11-10 23:58:01.000000"
        for row in rows:
            row["day"] = "2026-11-10"
        owned = own(rows)
        activity = {**rows[1], "id": "99", "at": "2026-11-20 00:20:00.000000", "day": "2026-11-20", "event": "toilet_search", "traffic": "UNFLAGGED"}
        result = self.analyze(rows + [activity], mapping, owned)
        self.assertEqual(2, len(result["restore"]))
        self.assertFalse(result["selected"])

    def test_actual_inventory_does_not_disappear_when_cohort_decays(self):
        rows, mapping = fixture(1)
        owned = own(rows)
        result = self.analyze(rows, mapping, owned)
        self.assertFalse(result["selected"])
        report = c.report(result, rows, owned, NOW, "ready", {"complete": True})
        self.assertEqual(1, report["coverage"]["classifiedSessions"])
        self.assertEqual(2, report["coverage"]["flaggedEvents"])
        self.assertEqual("PATTERN_INFERRED", report["daily"][0]["classification"])

    def test_calendar_window_and_orphan_coverage(self):
        rows, mapping = fixture(1)
        orphan = {**rows[0], "id": "99", "session": "F" * 64, "event": "page_view"}
        result = self.analyze(rows + [orphan], mapping)
        self.assertEqual(3, result["coverage"]["totalEvents"])
        self.assertEqual("2026-11-14", str(c.window_floor(NOW).date()))

    def test_owned_orphan_restored_when_start_has_expired(self):
        rows, mapping = fixture(1)
        rows = rows[1:]
        owned = own(rows)
        activity = {**rows[0], "id": "99", "event": "toilet_search", "traffic": "UNFLAGGED"}
        result = self.analyze(rows + [activity], mapping, owned)
        self.assertEqual(1, len(result["restore"]))
        self.assertFalse(result["selected"])


class ScannerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = c.load_parser(Path(c.__file__).with_name("origin_parser.py"))

    def line(self, ip="8.8.8.8", minute="00", ua="Chrome/120.0.0.0 Windows"):
        return (ip + ' - - [20/Nov/2026:16:' + minute + ':00 +0900] "POST /api/v1/analytics/events HTTP/1.1" 200 2 "-" "' + ua + '"\n').encode()

    def test_incremental_future_snapshot_rotation_and_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "access.log"
            path.write_bytes(self.line())
            state = c.open_state()
            self.assertTrue(c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)["complete"])
            self.assertEqual(1, len(c.mappings(state)))
            self.assertEqual(0, c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)["linesScanned"])
            with path.open("ab") as stream:
                stream.write(self.line("9.9.9.9", "30"))  # after fixed DB cutoff; retained for next run
            c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)
            self.assertEqual(2, len(c.mappings(state)))
            rotated = Path(directory) / "access.log.1"
            path.rename(rotated)
            path.write_bytes(self.line("1.1.1.1"))
            c.scan_logs(state, [rotated, path], b"K" * 32, self.parser, NOW)
            self.assertEqual(3, len(c.mappings(state)))
            path.write_bytes(self.line("7.7.7.7"))  # same-size copytruncate; identical UA tail
            c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)
            self.assertEqual(4, len(c.mappings(state)))

    def test_partial_trailing_record_and_parse_error_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "access.log"
            full = self.line()
            path.write_bytes(full[:-1])
            state = c.open_state()
            self.assertFalse(c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)["complete"])
            self.assertEqual(0, state.execute("SELECT offset FROM files").fetchone()[0])
            path.write_bytes(full)
            self.assertTrue(c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)["complete"])
            with path.open("ab") as stream:
                stream.write(b"POST /api/v1/analytics/events unsupported\n")
            self.assertFalse(c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)["complete"])
            self.assertFalse(c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)["complete"])

    def test_gzip_resume_and_readonly_state_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            path, database = Path(directory) / "access.log.gz", Path(directory) / "private.sqlite"
            with gzip.open(path, "wb") as stream:
                stream.write(self.line())
            state = c.open_state(database)
            c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)
            state.close()
            original = database.read_bytes()
            state = c.open_state(database, readonly=True)
            self.assertEqual(0, c.scan_logs(state, [path], b"K" * 32, self.parser, NOW)["linesScanned"])
            state.execute("DELETE FROM mappings")
            state.commit()
            state.close()
            self.assertEqual(original, database.read_bytes())


class FakeTransaction:
    def __init__(self, database):
        self.database, self.snapshot, self.closed = database, copy.deepcopy(database.rows), False

    def execute(self, sql):
        if "FOR UPDATE" in sql:
            return [json.dumps(row) for row in self.database.rows]
        if sql.startswith("UPDATE service_analytics_event"):
            ids = sql.split("event_id IN (")[1].split(")")[0].split(",")
            target = "BOT" if "SET traffic_class='BOT'" in sql else "UNFLAGGED"
            source = "UNFLAGGED" if target == "BOT" else "BOT"
            changed = 0
            for row in self.database.rows:
                if row["id"] in ids and row["traffic"] == source:
                    row["traffic"], changed = target, changed + 1
            return [str(changed)]
        if sql == "COMMIT":
            if self.database.crash_before_commit:
                raise RuntimeError("SIMULATED_CRASH")
            self.snapshot = copy.deepcopy(self.database.rows)
        return []

    def close(self):
        self.database.rows = copy.deepcopy(self.snapshot)
        self.closed = True


class FakeDatabase:
    def __init__(self, rows):
        self.rows, self.crash_before_commit = copy.deepcopy(rows), False

    def transaction(self):
        return FakeTransaction(self)


class CommitFaultState:
    """Fail the SQLite acknowledgement after the external MySQL commit."""
    def __init__(self, state):
        self.state, self.commits = state, 0

    def __getattr__(self, name):
        return getattr(self.state, name)

    def commit(self):
        self.commits += 1
        if self.commits == 2:
            raise RuntimeError("ACKNOWLEDGEMENT_CRASH")
        self.state.commit()


class LedgerTest(unittest.TestCase):
    def test_apply_exact_ids_original_flag_preservation_and_idempotence(self):
        rows, mapping = fixture(1, {**PROFILE, "version": "145.0.0.0", "os": "Linux"})
        mapping[rows[0]["visitor"]][0]["known_prior"] = 1
        state, db = c.open_state(), FakeDatabase(rows)
        analysis = c.analyze(rows, mapping, {}, NOW)
        result = c.apply_analysis(state, db, analysis, NOW)
        self.assertEqual(2, result["newlyFlaggedEvents"])
        self.assertEqual(["BOT", "BOT"], [r["traffic"] for r in db.rows])
        self.assertEqual(2, state.execute("SELECT COUNT(*) FROM ledger WHERE previous_class='UNFLAGGED' AND status='applied'").fetchone()[0])
        after = c.analyze(db.rows, mapping, c.owned_ledger(state), NOW)
        self.assertEqual(0, c.apply_analysis(state, db, after, NOW)["batchCount"])
        self.assertEqual(1, state.execute("SELECT COUNT(*) FROM batches").fetchone()[0])
        self.assertTrue(state.execute("SELECT 1 FROM pending_rollups").fetchone())

    def test_late_activity_invalidates_plan_before_any_write(self):
        rows, mapping = fixture(1, {**PROFILE, "version": "145.0.0.0", "os": "Linux"})
        mapping[rows[0]["visitor"]][0]["known_prior"] = 1
        analysis = c.analyze(rows, mapping, {}, NOW)
        db = FakeDatabase(rows + [{**rows[0], "id": "99", "event": "toilet_search"}])
        state = c.open_state()
        with self.assertRaisesRegex(RuntimeError, "PLAN_EVENTSET_CHANGED"):
            c.apply_analysis(state, db, analysis, NOW)
        self.assertFalse(state.execute("SELECT 1 FROM ledger").fetchone())

    def test_crash_recovery_prepared_not_committed_and_committed(self):
        rows, mapping = fixture(1, {**PROFILE, "version": "145.0.0.0", "os": "Linux"})
        mapping[rows[0]["visitor"]][0]["known_prior"] = 1
        state, db = c.open_state(), FakeDatabase(rows)
        db.crash_before_commit = True
        with self.assertRaisesRegex(RuntimeError, "SIMULATED_CRASH"):
            c.apply_analysis(state, db, c.analyze(rows, mapping, {}, NOW), NOW)
        self.assertEqual(2, state.execute("SELECT COUNT(*) FROM ledger WHERE status='prepared'").fetchone()[0])
        c.recover(state, db, NOW)
        self.assertEqual(2, state.execute("SELECT COUNT(*) FROM ledger WHERE status='not_applied'").fetchone()[0])
        state.execute("UPDATE ledger SET status='prepared'")
        for row in db.rows:
            row["traffic"] = "BOT"
        c.recover(state, db, NOW)
        self.assertEqual(2, state.execute("SELECT COUNT(*) FROM ledger WHERE status='applied'").fetchone()[0])

    def test_conditional_rollback_and_retention(self):
        rows, _ = fixture(1)
        state = c.open_state()
        own(rows, state)
        plan, undo = c.rollback_plan(state, rows, "a" * 64)
        self.assertEqual(2, plan["events"])
        db = FakeDatabase(rows)
        c.apply_rollback(state, db, undo, "a" * 64, NOW)
        self.assertEqual(2, state.execute("SELECT COUNT(*) FROM ledger WHERE status='rolledback'").fetchone()[0])
        self.assertEqual(["UNFLAGGED", "UNFLAGGED"], [r["traffic"] for r in db.rows])
        state.execute("UPDATE ledger SET occurred_at='2026-09-01 00:00:00'")
        c.clean_state(state, [], NOW)
        self.assertEqual(0, state.execute("SELECT COUNT(*) FROM ledger").fetchone()[0])

    def test_crash_after_mysql_commit_before_sqlite_acknowledgement(self):
        rows, mapping = fixture(1, {**PROFILE, "version": "145.0.0.0", "os": "Linux"})
        mapping[rows[0]["visitor"]][0]["known_prior"] = 1
        inner, db = c.open_state(), FakeDatabase(rows)
        state = CommitFaultState(inner)
        with self.assertRaisesRegex(RuntimeError, "ACKNOWLEDGEMENT_CRASH"):
            c.apply_analysis(state, db, c.analyze(rows, mapping, {}, NOW), NOW)
        self.assertEqual(["BOT", "BOT"], [r["traffic"] for r in db.rows])
        self.assertEqual(2, inner.execute("SELECT COUNT(*) FROM ledger WHERE status='prepared'").fetchone()[0])
        c.recover(inner, db, NOW)
        self.assertEqual(2, inner.execute("SELECT COUNT(*) FROM ledger WHERE status='applied'").fetchone()[0])

    def test_restore_crash_after_mysql_commit_before_sqlite_acknowledgement(self):
        rows, mapping = fixture(1)
        inner = c.open_state()
        owned = own(rows, inner)
        rows.append({**rows[0], "id": "99", "event": "toilet_search", "traffic": "UNFLAGGED"})
        db, state = FakeDatabase(rows), CommitFaultState(inner)
        with self.assertRaisesRegex(RuntimeError, "ACKNOWLEDGEMENT_CRASH"):
            c.apply_analysis(state, db, c.analyze(rows, mapping, owned, NOW), NOW)
        self.assertTrue(all(r["traffic"] == "UNFLAGGED" for r in db.rows))
        self.assertEqual(2, inner.execute("SELECT COUNT(*) FROM ledger WHERE status='restore_prepared'").fetchone()[0])
        c.recover(inner, db, NOW)
        self.assertEqual(2, inner.execute("SELECT COUNT(*) FROM ledger WHERE status='restored'").fetchone()[0])

    def test_manual_rollback_suppresses_future_reclassification(self):
        rows, mapping = fixture(1, {**PROFILE, "version": "145.0.0.0", "os": "Linux"})
        mapping[rows[0]["visitor"]][0]["known_prior"] = 1
        result = c.analyze(rows, mapping, {}, NOW, {rows[0]["id"]})
        self.assertFalse(result["selected"])

    def test_apply_requires_explicit_flags_before_database_access(self):
        with patch.object(c, "Database", side_effect=AssertionError("should not access host")):
            with self.assertRaisesRegex(RuntimeError, "EXPLICIT_APPLY_FLAG_REQUIRED"):
                c.main(["--apply"])
            with self.assertRaisesRegex(RuntimeError, "APPROVED_POLICY_DIGEST_REQUIRED"):
                c.main(["--run", "--apply-approved", "--expected-policy", "wrong"])


if __name__ == "__main__":
    unittest.main()
