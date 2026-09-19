import copy
from contextlib import closing
from datetime import datetime, timedelta
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("collect", Path(__file__).with_name("collect.py"))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def raw(ts, monotonic=1000):
    return dict(ts=ts, monotonic=monotonic, boot="test-boot", cpu=[100, 0, 0, 900, 0, 0, 0, 0],
                counters=dict(rx_bytes=1000, tx_bytes=1000, rx_errors=0, tx_errors=0, rx_dropped=0, tx_dropped=0),
                ifindex=2, interface="eth0", memoryPercent=25, diskPercent=6, inodePercent=1,
                memoryPressurePercent=0, ioPressurePercent=0, memoryTotalBytes=16000,
                memoryAvailableBytes=12000, downloadMbps=500, uploadMbps=100, linkUp=True)


class CollectorTest(unittest.TestCase):
    def test_rates_use_elapsed_time_and_independent_capacity(self):
        previous=raw(10000)
        now=raw(10060,1060)
        now['cpu']=[180,0,0,920,0,0,0,0]
        now['counters'].update(rx_bytes=30000001000,tx_bytes=750001000)
        value=c.derive(now,previous)
        self.assertEqual(value['cpuPercent'],80)
        self.assertEqual(value['rxMbps'],4000)
        self.assertEqual(value['txMbps'],100)
        self.assertEqual(value['rxUtilPercent'],800) # LAN traffic may exceed WAN contract.
        self.assertEqual(value['txUtilPercent'],100)

    def test_reboot_missing_clock_and_gap_are_unknown_not_zero(self):
        previous=raw(10000)
        for changes in ({'boot':'new'}, {'monotonic':1200,'ts':10200}, {'ts':10200}, {'boot':None}):
            now=raw(10060,1060);now.update(changes)
            value=c.derive(now,previous)
            self.assertIsNone(value['cpuPercent'])
            self.assertIsNone(value['rxBytes'])
            self.assertEqual(value['intervalSeconds'],0)

    def test_counter_reset_or_interface_change_does_not_create_traffic(self):
        previous=raw(10000);now=raw(10060,1060)
        now['counters']['rx_bytes']=1
        self.assertIsNone(c.derive(now,previous)['rxBytes'])
        now['ifindex']=3
        self.assertIsNone(c.derive(now,previous)['txBytes'])

    def test_iowait_decrease_invalidates_cpu_without_corrupting_network(self):
        previous=raw(10000);previous['cpu'][4]=50
        now=raw(10060,1060);now['counters']['rx_bytes']=2000
        result=c.derive(now,previous)
        self.assertIsNone(result['cpuPercent'])
        self.assertEqual(result['rxBytes'],1000)

    def test_midnight_intervals_are_split_and_unknown_is_not_zero(self):
        midnight=c.day_bounds('2026-09-20')[0]
        sample=dict(ts=midnight+30,intervalSeconds=60,cpuPercent=90,memoryPercent=50,rxBytes=6000,txBytes=None)
        for day in ('2026-09-19','2026-09-20'):
            value=c.aggregate([sample],day,midnight+30)
            self.assertEqual(value['rxBytes'],3000)
            self.assertEqual(value['metrics']['cpuPercent']['avg'],90)
            self.assertEqual(value['metrics']['cpuPercent']['above80Minutes'],.5)
            self.assertIsNone(value['metrics']['diskPercent']['avg'])
            self.assertIsNone(value['txBytes'])

    def test_weighted_percentile_and_coverage_with_gap(self):
        start=c.day_bounds('2026-09-19')[0]
        samples=[dict(ts=start+60,intervalSeconds=60,cpuPercent=10),dict(ts=start+180,intervalSeconds=0,cpuPercent=None),dict(ts=start+240,intervalSeconds=60,cpuPercent=90)]
        day=c.aggregate(samples,'2026-09-19',start+240)
        self.assertEqual(day['coveragePercent'],50)
        self.assertEqual(day['metrics']['cpuPercent']['avg'],50)
        self.assertEqual(day['metrics']['cpuPercent']['p95'],90)

    def test_alert_requires_contiguous_fifteen_minutes(self):
        samples=[dict(ts=1000+i*60,intervalSeconds=60,cpuPercent=81,memoryPercent=20) for i in range(15)]
        self.assertEqual(c.assessment(samples)['level'],'WARN')
        self.assertEqual(c.assessment(samples[-1:])['level'],'WATCH')
        samples[-2]['intervalSeconds']=0
        self.assertEqual(c.assessment(samples)['level'],'WATCH')

    def test_persistence_rollover_retention_and_private_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            start=c.day_bounds('2026-09-19')[0]
            c.persist(root,raw(start-30))
            c.persist(root,raw(start+30,1060))
            data=json.loads((root/'exports/summary.json').read_text(encoding='utf-8'))
            self.assertEqual(len(data['days']),2)
            self.assertNotIn('boot',data['latest'])
            self.assertNotIn('counters',data['latest'])
            self.assertEqual(data['days'][0]['observedMinutes'],.5)
            c.persist(root,raw(start+31*86400,1060+31*86400))
            self.assertFalse((root/'exports/2026-09-19.json').exists())
            with closing(sqlite3.connect(root/'metrics.sqlite')) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM samples').fetchone()[0],1)
            data=json.loads((root/'exports/summary.json').read_text(encoding='utf-8'))
            self.assertEqual(data['days'][0]['date'],'2026-09-18')
            self.assertIsNone(data['latest']['cpuPercent'])

    def test_backwards_clock_does_not_replace_latest(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);c.persist(root,raw(100000))
            c.persist(root,raw(99999,1060))
            self.assertEqual(json.loads((root/'exports/summary.json').read_text(encoding='utf-8'))['latest']['ts'],100000)


if __name__ == '__main__':
    unittest.main()
