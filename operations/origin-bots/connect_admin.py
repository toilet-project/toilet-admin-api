#!/usr/bin/env python3
"""Approved, pinned, configuration-only admin connection. Never prints secrets."""
import argparse
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path('/home/luha/toilet-admin')
COMPOSE = ROOT / 'docker-compose.yml'
EXPORT = Path('/var/snap/docker/common/geupddong-origin-bots/exports')
TARGET = '/var/lib/geupddong-origin-bots'
KEY = 'ORIGIN_BOTS_DIRECTORY'
MOUNT = dict(type='bind', source=str(EXPORT), target=TARGET, read_only=True,
             bind={'create_host_path': False})


def require(value, message='ORIGIN_BOTS_CONNECT_HELD'):
    if not value:
        raise ValueError(message)


def run(args, data=None, timeout=30):
    return subprocess.run(args, input=data, text=True, capture_output=True,
                          check=True, timeout=timeout).stdout


def candidate(raw):
    text = raw.decode('utf-8')
    require(KEY not in text and TARGET not in text)
    marker = '    logging:\n'
    require(text.count(marker) == 1 and text.count('    volumes:\n') == 1)
    # Existing monitor mount stays byte-identical; append one mount to that list.
    addition = ('      - type: bind\n        source: ' + str(EXPORT) + '\n'
                '        target: ' + TARGET + '\n        read_only: true\n'
                '        bind:\n          create_host_path: false\n'
                '    environment:\n      ' + KEY + ': ' + TARGET + '\n')
    require('    environment:' not in text)
    return text.replace(marker, addition + marker).encode('utf-8')


def validate_render(before, after):
    expected = copy.deepcopy(before)
    service = expected['services']['toilet-admin']
    require(KEY not in service.get('environment', {}))
    service.setdefault('environment', {})[KEY] = TARGET
    service.setdefault('volumes', []).append(MOUNT)
    require(after == expected, 'ORIGIN_BOTS_CONNECT_UNRELATED_CHANGE')


def runtime(obj):
    config = copy.deepcopy(obj['Config'])
    config.pop('Hostname', None)
    config['Env'] = sorted(config['Env'])
    config.pop('Labels', None)  # Compose hashes/container identity change on recreation.
    return dict(config=config, mounts=sorted(obj['Mounts'], key=lambda v: v['Destination']),
                ports=obj['HostConfig']['PortBindings'], restart=obj['HostConfig']['RestartPolicy'],
                network=obj['HostConfig']['NetworkMode'], log=obj['HostConfig']['LogConfig'])


def validate_runtime(before, after):
    expected = runtime(before)
    expected['config']['Env'] = sorted(expected['config']['Env'] + [KEY + '=' + TARGET])
    expected['mounts'].append(dict(Type='bind', Source=str(EXPORT), Destination=TARGET,
                                  Mode='', RW=False, Propagation='rprivate'))
    expected['mounts'].sort(key=lambda v: v['Destination'])
    require(runtime(after) == expected, 'ORIGIN_BOTS_CONNECT_RUNTIME_CHANGED')


def inspect():
    return {role: json.loads(run(['docker', 'inspect', 'toilet-' + role]))[0]
            for role in ('admin', 'api', 'batch')}


def owned(path):
    require(path.resolve(strict=True) == path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600)
    return path.read_bytes()


def compose(*args, file=COMPOSE):
    return ['docker', 'compose', '--project-directory', str(ROOT), '-f', str(file), *args]


def rendered(raw=None):
    return json.loads(run(compose('config', '--format', 'json', file='-' if raw else COMPOSE),
                          raw.decode('utf-8') if raw else None))


def replace(raw):
    fd, temporary = tempfile.mkstemp(prefix='.origin-bots-connect-', dir=ROOT)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, COMPOSE)


def healthy(obj):
    env = dict(item.split('=', 1) for item in obj['Config']['Env'])
    port = env['ADMIN_PORT']
    require(port.isdigit() and 0 < int(port) < 65536)
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
            'http://127.0.0.1:' + port + '/actuator/health', timeout=4) as response:
        require(response.status == 200 and json.load(response).get('status') == 'UP')


def restart():
    run(compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never',
                '--wait', '--wait-timeout', '90', 'toilet-admin'), timeout=110)
    deadline = time.monotonic() + 60
    while True:
        try:
            healthy(inspect()['admin'])
            return
        except Exception:
            if time.monotonic() >= deadline:
                raise ValueError('ORIGIN_BOTS_CONNECT_HEALTH_FAILED') from None
            time.sleep(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--admin-commit', required=True)
    parser.add_argument('--api-commit', required=True)
    parser.add_argument('--batch-commit', required=True)
    parser.add_argument('--apply-approved', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 1000 and ROOT.resolve(strict=True) == ROOT)
    require(all(re.fullmatch('[a-f0-9]{40}', v) for v in
                (args.admin_commit, args.api_commit, args.batch_commit)))
    require(EXPORT.resolve(strict=True) == EXPORT and EXPORT.is_dir())
    # Existing privacy-safe export must be healthy before admin configuration changes.
    raw_export = json.loads(run(['sudo', '-n', 'cat', str(EXPORT / 'origin-bots.json')]))
    require(raw_export['schema'] == 1 and raw_export['source'] == 'origin-nginx')
    from datetime import datetime, timezone
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(raw_export['generatedAt'].replace('Z', '+00:00'))).total_seconds()
    require(0 <= age < 180, 'ORIGIN_BOTS_CONNECT_STALE_EXPORT')
    spec = importlib.util.spec_from_file_location('ledger', '/home/luha/.local/bin/restore-ledger-context.py')
    context = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(context)
    with context.maintenance_lease.acquire(), (ROOT / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = inspect()
        for role in before:
            require(before[role]['State']['Running'] and
                    before[role]['Config']['Image'].endswith(':' + getattr(args, role + '_commit')))
        require(before['admin']['Config']['User'] in ('', 'root', '0', '0:0'))
        original, env = owned(COMPOSE), owned(ROOT / '.env')
        replacement = candidate(original)
        validate_render(rendered(), rendered(replacement))
        healthy(before['admin'])
        if args.apply_approved:
            fd, path = tempfile.mkstemp(prefix='.origin-bots-before-', suffix='.yml', dir=ROOT)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(original)
            try:
                require(owned(COMPOSE) == original and owned(ROOT / '.env') == env)
                replace(replacement)
                restart()
                after = inspect()
                validate_runtime(before['admin'], after['admin'])
                for role in ('api', 'batch'):
                    require(after[role]['Id'] == before[role]['Id'] and runtime(after[role]) == runtime(before[role]))
                require(owned(ROOT / '.env') == env)
            except Exception:
                require(owned(COMPOSE) == replacement, 'ORIGIN_BOTS_CONNECT_EXTERNAL_CHANGE')
                replace(original)
                restart()
                raise ValueError('ORIGIN_BOTS_CONNECT_FAILED_RESTORED') from None
    print(json.dumps({'result': 'connected' if args.apply_approved else 'checked',
                      'sameAdminImage': True, 'apiAndBatchUnchanged': True,
                      'rawLogsMounted': False, 'databaseWrites': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        print(message if re.fullmatch('ORIGIN_BOTS_[A-Z_]+', message) else
              'ORIGIN_BOTS_CONNECT_HELD detailsSuppressed=true')
        raise SystemExit(1)
