#!/usr/bin/env python3
"""Read-only Nginx audit. Emit aggregates; keep addresses, UA and URLs in memory.

Run with a fresh, private AUDIT_ALIAS_KEY (32+ characters), reusing it for chunks.
No file is created or changed. Resume tokens contain only log inventory/offsets.
Log timestamps have one-second resolution; interval statistics retain that limit.
"""
import argparse
import base64
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import glob
import gzip
import hashlib
import hmac
import ipaddress
import json
import os
import re
import sys
import time
from urllib.parse import urlsplit

KST = timezone(timedelta(hours=9))
TARGET = ipaddress.ip_network("216.246.215.0/24")
QUOTED = rb'"((?:[^"\\]|\\.)*)"'
COMBINED = re.compile(rb'^([^ ]+) \S+ \S+ \[([^\]]+)\] ' + QUOTED +
                      rb' (\d{3}) (?:\d+|-) ' + QUOTED + rb' ' + QUOTED + rb'(.*)$')
FACILITY = re.compile(r'/(?:api/v\d+/toilets|toilet)/(\d+)(?:/|$)')
BOT_NAMES = ("Google-InspectionTool", "Googlebot", "GoogleOther", "bingbot", "BingPreview",
             "Yeti", "Ads-Naver", "Applebot-Extended", "Applebot", "Baiduspider", "PetalBot",
             "OAI-SearchBot", "ChatGPT-User", "GPTBot", "Claude-SearchBot", "Claude-User",
             "ClaudeBot", "Meta-ExternalAgent", "facebookexternalhit", "Bytespider",
             "YandexBot", "AhrefsSiteAudit", "AhrefsBot", "SemrushBot", "Amazonbot",
             "DuckDuckBot", "CCBot", "archive.org_bot")


def unescape(raw):
    return re.sub(rb'\\x([0-9a-fA-F]{2})', lambda m: bytes([int(m[1], 16)]), raw).decode('utf-8', 'replace')


def parse_time(value):
    if value is None:
        raise ValueError('missing timestamp')
    if isinstance(value, (int, float)) or str(value).replace('.', '', 1).isdigit():
        return int(float(value))
    value = str(value)
    if re.match(r'^\d{2}/[A-Za-z]{3}/', value):
        return int(datetime.strptime(value, '%d/%b/%Y:%H:%M:%S %z').timestamp())
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('naive log timestamp has no documented source timezone')
    return int(parsed.timestamp())


def parse_line(raw, timestamp_cache):
    """Return private fields. Callers must never serialize this object."""
    if raw.lstrip().startswith(b'{'):
        obj = json.loads(raw)
        def get(*names):
            return next((obj[k] for k in names if obj.get(k) is not None), None)
        stamp = get('time_iso8601', 'time_local', '@timestamp', 'timestamp', 'time', 'msec')
        address = get('remote_addr', 'client_ip', 'client_address')
        ua = get('http_user_agent', 'user_agent', 'userAgent')
        referer = get('http_referer', 'referer', 'referrer')
        request = get('request', 'request_line')
        if request is None:
            method, uri = get('request_method', 'method'), get('request_uri', 'uri', 'path')
            if method and uri:
                request = str(method) + ' ' + str(uri) + ' HTTP/1.1'
        status = get('status', 'status_code')
        if not address or request is None or status is None:
            raise ValueError('unsupported JSON schema')
        at = parse_time(stamp)
        origin = get('http_origin', 'origin')
        secfetch = get('http_sec_fetch_site', 'sec_fetch_site')
        fields = {'referer': referer is not None, 'userAgent': ua is not None,
                  'origin': origin is not None, 'secFetchSite': secfetch is not None}
        return str(address), at, str(request), int(status), str(ua or ''), str(referer or ''), origin, secfetch, fields, 'json'
    match = COMBINED.match(raw.rstrip(b'\r\n'))
    if not match:
        raise ValueError('unsupported access format')
    address, stamp, request, status, referer, ua, tail = match.groups()
    if stamp not in timestamp_cache:
        if len(timestamp_cache) >= 8192:
            timestamp_cache.clear()
        timestamp_cache[stamp] = parse_time(stamp.decode('ascii'))
    fields = {'referer': True, 'userAgent': True, 'origin': False, 'secFetchSite': False}
    return (address.decode('ascii'), timestamp_cache[stamp], unescape(request), int(status),
            unescape(ua), unescape(referer), None, None, fields,
            'combined-with-uninterpreted-tail' if tail.strip() else 'combined')


def ua_context(raw):
    """Self-declared coarse UA only; this does not authenticate the sender."""
    low = raw.lower()
    name = next((name for name in BOT_NAMES if re.search(r'(?<![a-z0-9])' + re.escape(name.lower()) + r'(?![a-z0-9])', low)), None)
    generic = bool(re.search(r'bot|crawler|spider|headless|preview', low))
    product, version = 'Other', None
    for label, expression in (
        ('HeadlessChrome', r'HeadlessChrome/([\d.]+)'), ('Edge', r'(?:Edg|EdgA|EdgiOS)/([\d.]+)'),
        ('Samsung Internet', r'SamsungBrowser/([\d.]+)'), ('Chrome', r'(?:Chrome|CriOS)/([\d.]+)'),
        ('Firefox', r'(?:Firefox|FxiOS)/([\d.]+)'), ('Safari', r'Version/([\d.]+).*Safari/'),
        ('curl', r'curl/([\d.]+)'), ('python-requests', r'python-requests/([\d.]+)')):
        m = re.search(expression, raw, re.I)
        if m:
            product, version = label, m[1][:32]
            break
    osname = ('Android' if 'android' in low else 'iOS' if ('iphone' in low or 'ipad' in low)
              else 'Windows' if 'windows' in low else 'ChromeOS' if 'cros' in low
              else 'Linux' if 'linux' in low else 'macOS' if 'macintosh' in low else 'Other')
    app = next((label for token, label in (('kakaotalk', 'KAKAOTALK'), ('naver(', 'NAVER_APP'),
               ('naver/', 'NAVER_APP'), ('line/', 'LINE'), ('instagram', 'INSTAGRAM'),
               ('fbav/', 'FACEBOOK'), ('gsa/', 'GOOGLE_APP'), ('; wv)', 'ANDROID_WEBVIEW')) if token in low), None)
    context = {'product': product, 'version': version, 'os': osname, 'app': app,
               'declaredBot': name, 'automationToken': generic, 'headlessToken': 'headless' in low,
               'missingUserAgent': not raw or raw == '-'}
    return json.dumps(context, sort_keys=True, separators=(',', ':'))

