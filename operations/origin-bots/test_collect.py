import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

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

    def test_baidu_variants_are_declared_not_verified(self):
        for suffix in ("", "-render", "-image", "-video", "-news"):
            ua = "Mozilla/5.0 (compatible; Baiduspider" + suffix + "/2.0; +http://www.baidu.com/search/spider.html)"
            name, provider = c.identify(ua)
            self.assertEqual(name, "Baiduspider")
            self.assertIsNone(provider)
            # Even an address matching another verified provider proves nothing about Baidu.
            self.assertEqual(self.verifier.check(provider,"203.0.113.4",NOW),"declared")
        self.assertEqual(c.identify("BAIDUSPIDER/2.0"), ("Baiduspider", None))
        for ua in ("NotBaiduspider/2.0", "BaiduspiderFake/2.0", "Baiduspider-malware/1.0"):
            self.assertNotEqual(c.identify(ua)[0], "Baiduspider")

    def test_baidu_counts_once_without_raw_identifiers(self):
        self.log.write_bytes(line(ua="Baiduspider/2.0") + line(ua="Baiduspider-render/2.0"))
        self.run_log(); self.run_log()
        result = c.export(self.db,NOW,{})
        self.assertEqual(sum(row["count"] for row in result["rows"]), 2)
        self.assertEqual({row["bot"] for row in result["rows"]}, {"Baiduspider"})
        self.assertEqual({row["verification"] for row in result["rows"]}, {"declared"})
        stored = json.dumps(result) + "\n".join(self.db.iterdump())
        for secret in ("203.0.113.4", "Baiduspider/2.0", "PRIVATE", "/123"):
            self.assertNotIn(secret, stored)

    def test_apple_names_and_official_ip_verification(self):
        registry = {"apple": {"fetchedAt": c.stamp(NOW), "networks": ["17.166.24.0/24"]}}
        verifier = c.Verifier(registry, NOW, True)
        for ua in ("Applebot/0.1", "APPLEBOT/0.1",
                   "Mozilla/5.0 (Macintosh) Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
                   "Mozilla/5.0 (iPhone) Mobile/15E148 Safari/604.1 (Applebot/0.1; +http://www.apple.com/go/applebot)"):
            self.assertEqual(c.identify(ua), ("Applebot", "apple"))
        for ua in ("NotApplebot/0.1", "ApplebotFake/0.1", "Applebot-Extended/0.1"):
            self.assertNotEqual(c.identify(ua)[0], "Applebot")
        self.assertEqual(verifier.check("apple", "17.166.24.13", NOW), "verified")
        # An arbitrary Apple-owned IP is not sufficient evidence of Applebot.
        self.assertEqual(verifier.check("apple", "17.0.0.1", NOW), "unmatched")
        self.assertEqual(c.Verifier({}, NOW, True).check("apple", "17.166.24.13", NOW), "declared")
        self.assertEqual(c.Verifier(registry, NOW, False).check("apple", "17.166.24.13", NOW), "declared")
        self.assertEqual(c.Verifier(registry, NOW + dt.timedelta(days=2), True)
                         .check("apple", "17.166.24.13", NOW), "declared")
        self.assertEqual(verifier.check("apple", "17.166.24.13", NOW - dt.timedelta(days=2)), "declared")

    def test_apple_official_registry_and_fetch_failure(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.geturl.return_value = "https://search.developer.apple.com/applebot.json"
        response.read.return_value = json.dumps({"creationTime": "2026-09-15T10:00:00.000000",
            "prefixes": [{"ipv4Prefix": "17.166.24.0/24"}]}).encode()
        with patch.object(c.urllib.request, "urlopen", return_value=response) as fetch:
            registry = c.fetch_ranges(NOW, ["apple"])
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(fetch.call_args.args[0].full_url, response.geturl.return_value)
        self.assertEqual(c.Verifier(registry, NOW, True).check("apple", "17.166.24.13", NOW), "verified")
        with patch.object(c.urllib.request, "urlopen", side_effect=TimeoutError):
            self.assertEqual(c.fetch_ranges(NOW, ["apple"]), {})
        response.geturl.return_value = "https://example.com/untrusted"
        with patch.object(c.urllib.request, "urlopen", return_value=response):
            self.assertEqual(c.fetch_ranges(NOW, ["apple"]), {})

    def test_apple_upgrade_preserves_cursor_and_existing_other_without_raw_identifiers(self):
        self.verifier = c.Verifier({"apple": {"fetchedAt": c.stamp(NOW),
            "networks": ["17.166.24.0/24"]}}, NOW, True)
        self.log.write_bytes(line(ua="Examplebot/1.0"))
        self.run_log()
        with self.log.open("ab") as stream:
            stream.write(line(ua="Applebot/0.1", ip="17.166.24.13"))
            stream.write(line(ua="Applebot/0.1", ip="17.0.0.1"))
        self.run_log(); self.run_log()
        result = c.export(self.db, NOW, {})
        self.assertEqual(sum(row["count"] for row in result["rows"]), 3)
        self.assertEqual(sum(row["count"] for row in result["rows"] if row["bot"] == "Other bot"), 1)
        self.assertEqual({row["verification"] for row in result["rows"] if row["bot"] == "Applebot"},
                         {"verified", "unmatched"})
        stored = json.dumps(result) + "\n".join(self.db.iterdump())
        for secret in ("17.166.24.13", "17.0.0.1", "Applebot/0.1", "PRIVATE", "/123"):
            self.assertNotIn(secret, stored)

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
