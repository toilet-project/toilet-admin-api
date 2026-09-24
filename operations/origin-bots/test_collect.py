import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("collector", Path(__file__).with_name("collect.py"))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
NOW = dt.datetime(2026, 9, 24, 3, 0, tzinfo=c.UTC)


def line(ua="Yeti/1.1", ip="203.0.113.4", request="GET /api/v1/toilets/123?secret=PRIVATE HTTP/1.1", when="24/Sep/2026:02:30:00 +0000"):
    return f'{ip} - - [{when}] "{request}" 200 15 "https://example.com/private" "{ua}"\n'.encode()


class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.log = self.root / "access.log"
        self.db = c.database(self.root / "state.sqlite")
        self.registry = {"naver": {"fetchedAt":c.stamp(NOW),"networks":["203.0.113.0/24"]}}
        self.verifier = c.Verifier(self.registry,NOW,True)

    def tearDown(self):
        self.db.close(); self.temp.cleanup()

    def run_log(self, files=None, **kwargs):
        return c.consume(self.db, files or [self.log], self.verifier, NOW, **kwargs)

    def test_names_and_spoofs(self):
        for ua, name in [("Googlebot/2.1","Googlebot"),("Mozilla/5.0 (compatible; Yeti/1.1; x)","Naver Yeti"),
                         ("bingbot/2.0","Bingbot"),("Ads-Naver/1.0","Naver Ads-Naver"),("Blueno/1.0","Naver Blueno")]:
            self.assertEqual(c.identify(ua)[0],name)
        self.assertNotEqual(c.identify("NotGooglebot/1.0")[0], "Googlebot")
        self.assertIsNone(c.identify("Mozilla/5.0 Chrome/123 Safari/123")[0])

    def test_verification_requires_fresh_list_and_trusted_real_ip(self):
        self.assertEqual(self.verifier.check("naver","203.0.113.4",NOW),"verified")
        self.assertEqual(self.verifier.check("naver","198.51.100.4",NOW),"unmatched")
        self.assertEqual(self.verifier.check("google","203.0.113.4",NOW),"declared")
        self.assertEqual(c.Verifier(self.registry,NOW,False).check("naver","203.0.113.4",NOW),"declared")
        self.assertEqual(c.Verifier(self.registry,NOW+dt.timedelta(days=2),True).check("naver","203.0.113.4",NOW),"declared")
        self.assertEqual(self.verifier.check("naver","203.0.113.4",NOW-dt.timedelta(days=2)),"declared")
        self.assertEqual(self.verifier.check("naver","invalid",NOW),"declared")

    def test_counts_once_and_never_exports_identifiers(self):
        self.log.write_bytes(line()+line(ua="Mozilla/5.0 Chrome/1.0")+line())
        self.run_log(); self.run_log()
        result = c.export(self.db,NOW,{})
        self.assertEqual(sum(r["count"] for r in result["rows"]),2)
        self.assertEqual(result["rows"][0]["path"],"toilets_api")
        for secret in ["203.0.113.4", "PRIVATE", "example.com", "Yeti/1.1", "/123"]:
            self.assertNotIn(secret,json.dumps(result))
            self.assertNotIn(secret,"\n".join(self.db.iterdump()))

    def test_rotation_and_partial_lines(self):
        self.log.write_bytes(line()); self.run_log()
        old = self.log.with_name("access.log.1"); self.log.rename(old)
        with old.open("ab") as f: f.write(line())
        self.log.write_bytes(line()[:-1]); self.run_log([old,self.log])
        self.assertEqual(sum(r[0] for r in self.db.execute("SELECT count FROM hits")),2)
        with self.log.open("ab") as f: f.write(b"\n")
        self.run_log([old,self.log])
        self.assertEqual(sum(r[0] for r in self.db.execute("SELECT count FROM hits")),3)

    def test_work_budget_resumes_and_retention(self):
        self.log.write_bytes(line()*3+line(when="01/Aug/2026:00:00:00 +0000"))
        self.assertTrue(self.run_log(max_lines=2)["backlog"])
        self.run_log()
        self.assertEqual(sum(r[0] for r in self.db.execute("SELECT count FROM hits")),3)

    def test_unknown_routes_and_escaped_injection(self):
        self.assertEqual(c.route_key("GET /profile/private?token=secret HTTP/1.1"),"other")
        self.assertEqual(c.route_key("GET /en/toilet/123 HTTP/1.1"),"toilet_detail")
        self.log.write_bytes(b"malformed\n" + line(ua='NotGooglebot/1.0 \\"evil'))
        result=self.run_log()
        self.assertGreaterEqual(result["malformed"],1)
        self.assertNotIn("evil",json.dumps(c.export(self.db,NOW,result)))

    def test_copy_truncation_and_missing_rotation_are_visible(self):
        self.log.write_bytes(line()*3); self.run_log()
        self.log.write_bytes(line()); self.run_log()
        self.assertEqual(dict(self.db.execute("SELECT key,value FROM meta"))["coverageWarning"],"log-truncated")


if __name__ == "__main__": unittest.main()
