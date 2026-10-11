import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import collect as c
import reclassify as r
from test_collect import line, NOW


class ReclassificationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.database = self.root / 'aggregates.sqlite'
        self.log = self.root / 'access.log'
        self.output = self.root / 'plan'
        self.exports = self.root / 'exports'
        self.exports.mkdir()
        # Different times and statuses exercise endpoint/error preservation.
        self.log.write_bytes(line(ua='AhrefsBot/7.0', when='24/Sep/2026:02:01:00 +0000')
                             + line(ua='Unknownbot/1.0', when='24/Sep/2026:02:15:00 +0000')
                             + line(ua='AhrefsBot/7.0', when='24/Sep/2026:02:59:00 +0000')
                             + line(ua='AhrefsBot/7.0').replace(b' 200 ', b' 404 ')
                             + line(ua='AhrefsSiteAudit/6.1')
                             + line(ua='Yeti/1.1'))
        with closing(c.database(self.database)) as db:
            with patch.object(c, 'ADDITIONAL_BOTS', []):
                c.consume(db, [self.log], c.Verifier({'naver': {'fetchedAt': c.stamp(NOW),
                    'networks': ['203.0.113.0/24']}}, NOW, True), NOW)
            c.atomic_json(self.exports / 'origin-bots.json', c.export(db, NOW, {}))

    def tearDown(self):
        self.temp.cleanup()

    def create_plan(self, **kwargs):
        return r.plan(self.database, [self.log], self.output, NOW, **kwargs)

    def test_plan_preserves_live_state_counts_errors_cursors_and_private_fields(self):
        with r.readonly(self.database) as db:
            before = r.fingerprint(db)
            invariant = r.invariant(db)
        # Unconsumed appends must not be counted by historical replay.
        with self.log.open('ab') as stream:
            stream.write(line(ua='AhrefsBot/7.0'))
        result = self.create_plan()
        self.assertEqual(result['reclassified'], {'AhrefsBot': 3})
        self.assertEqual(result['totalRequests'], 5)  # SiteAudit was not previously counted.
        self.assertFalse(result['operationalDataChanged'])
        with r.readonly(self.database) as db:
            self.assertEqual(r.fingerprint(db), before)
        with r.readonly(self.output / 'candidate.sqlite') as db:
            self.assertEqual(r.invariant(db), invariant)
            self.assertEqual(db.execute("SELECT count,first,last FROM hits WHERE bot='Other bot'").fetchone(),
                             (1, '2026-09-24T02:15:00Z', '2026-09-24T02:15:00Z'))
            self.assertEqual(db.execute("SELECT verification FROM hits WHERE bot='Naver Yeti'").fetchone()[0], 'verified')
            self.assertEqual(db.execute("SELECT count FROM hits WHERE bot='AhrefsBot' AND status=4").fetchone()[0], 1)
            stored = '\n'.join(db.iterdump())
        serialized = stored + (self.output / 'origin-bots.json').read_text() + (self.output / 'plan.json').read_text()
        for private in ('203.0.113.4', 'PRIVATE', 'example.com', 'AhrefsBot/7.0', '/123'):
            self.assertNotIn(private, serialized)

    def test_partially_missing_evidence_is_not_guessed(self):
        with r.writable(self.database) as db:
            db.execute("UPDATE hits SET count=count+1 WHERE bot='Other bot' AND status=2")
        result = self.create_plan()
        self.assertEqual(result['reclassified'], {'AhrefsBot': 1})  # Fully reconciled 4xx only.
        self.assertEqual(result['skippedBuckets'], 1)
        with r.readonly(self.output / 'candidate.sqlite') as db:
            self.assertEqual(db.execute("SELECT count FROM hits WHERE bot='Other bot' AND status=2").fetchone()[0], 4)

    def test_endpoint_mismatch_does_not_move_a_matching_count(self):
        with r.writable(self.database) as db:
            db.execute("UPDATE hits SET first='2026-09-24T02:00:00Z' WHERE bot='Other bot' AND status=2")
        self.assertEqual(self.create_plan()['skippedBuckets'], 1)

    def test_consumed_bytes_missing_or_changed_boundary_hold_the_plan(self):
        self.log.write_bytes(line())
        with self.assertRaisesRegex(ValueError, 'no longer retained'):
            self.create_plan()

    def test_plan_budget_is_bounded(self):
        with self.assertRaisesRegex(ValueError, 'time budget'):
            self.create_plan(seconds=-1)

    @unittest.skipUnless(__import__('os').name == 'posix', 'Collector flock is Linux-only')
    def test_approved_apply_and_repeated_plan_are_idempotent(self):
        self.create_plan()
        with r.readonly(self.database) as db:
            cursor = list(db.execute('SELECT * FROM cursor'))
        self.assertTrue(r.apply(self.database, self.output, self.exports, approved=True)['totalsPreserved'])
        with r.readonly(self.database) as db:
            self.assertEqual(list(db.execute('SELECT * FROM cursor')), cursor)
        result = r.plan(self.database, [self.log], self.root / 'again', NOW)
        self.assertEqual(result['reclassified'], {})
        self.assertTrue((self.output / 'before.sqlite').is_file())
        with self.assertRaisesRegex(ValueError, 'changed'):
            r.apply(self.database, self.output, self.exports, approved=True)

    @unittest.skipUnless(__import__('os').name == 'posix', 'Collector flock is Linux-only')
    def test_live_collector_progress_invalidates_old_plan(self):
        self.create_plan()
        with self.log.open('ab') as stream:
            stream.write(line(ua='Unknownbot/1.0'))
        with closing(c.database(self.database)) as db:
            c.consume(db, [self.log], c.Verifier({}, NOW, False), NOW)
        with self.assertRaisesRegex(ValueError, 'changed'):
            r.apply(self.database, self.output, self.exports, approved=True)

    def test_explicit_review_gate_is_required(self):
        self.create_plan()
        with self.assertRaisesRegex(ValueError, 'approval'):
            r.apply(self.database, self.output, self.exports)


if __name__ == '__main__':
    unittest.main()
