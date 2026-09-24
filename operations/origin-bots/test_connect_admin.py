import copy
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

# Host-only entry point is never executed by these synthetic tests.
spec = importlib.util.spec_from_file_location('connection', Path(__file__).with_name('connect_admin.py'))
c = importlib.util.module_from_spec(spec)
if sys.platform == 'win32':
    with patch.dict(sys.modules, {'fcntl': types.SimpleNamespace()}):
        spec.loader.exec_module(c)
else:
    spec.loader.exec_module(c)

COMPOSE = b'''services:
  toilet-admin:
    image: fixture:unchanged
    volumes:
      - type: bind
        source: /monitor/exports
        target: /monitor
        read_only: true
    logging:
      driver: json-file
'''


class ConnectionTest(unittest.TestCase):
    def test_injection_preserves_monitor_and_rejects_reapplication(self):
        after = c.candidate(COMPOSE)
        self.assertIn(b'        target: /monitor\n        read_only: true\n', after)
        self.assertEqual(after.count(b'    volumes:\n'), 1)
        self.assertIn(b'    environment:\n      ORIGIN_BOTS_DIRECTORY:', after)
        with self.assertRaises(ValueError): c.candidate(after)
        with self.assertRaises(ValueError): c.candidate(b'services: {}')

    def test_only_two_rendered_changes_allowed(self):
        before = {'services': {'toilet-admin': {'image': 'fixture', 'environment': {'PRIVATE': 'secret'},
                    'volumes': [{'type': 'bind', 'source': '/existing'}]}}}
        after = copy.deepcopy(before)
        after['services']['toilet-admin']['environment'][c.KEY] = c.TARGET
        after['services']['toilet-admin']['volumes'].append(c.MOUNT)
        c.validate_render(before, after)
        normalized = copy.deepcopy(after)
        normalized['services']['toilet-admin']['volumes'][-1]['bind'] = {}
        c.validate_render(before, normalized)
        normalized['services']['toilet-admin']['volumes'][-1]['bind']['create_host_path'] = True
        with self.assertRaises(ValueError): c.validate_render(before, normalized)
        for bad in ('image', 'ports', 'restart'):
            wrong = copy.deepcopy(after)
            wrong['services']['toilet-admin'][bad] = 'unexpected'
            with self.assertRaises(ValueError): c.validate_render(before, wrong)
        self.assertNotIn(c.KEY, before['services']['toilet-admin']['environment'])

    def test_runtime_rejects_changed_secret_or_image_or_write_mount(self):
        before = {'Config': {'Env': ['PRIVATE=secret'], 'Image': 'fixture', 'Hostname': 'old', 'Labels': {}},
                  'Mounts': [], 'HostConfig': {'PortBindings': {}, 'RestartPolicy': {},
                                             'NetworkMode': 'fixture', 'LogConfig': {}}}
        after = copy.deepcopy(before)
        after['Config']['Env'].append(c.KEY + '=' + c.TARGET)
        after['Config']['Hostname'] = 'new'
        after['Mounts'].append(dict(Type='bind', Source=str(c.EXPORT), Destination=c.TARGET,
                                   Mode='', RW=False, Propagation='rprivate'))
        c.validate_runtime(before, after)
        wrong = copy.deepcopy(after); wrong['Config']['Image'] = 'different'
        with self.assertRaises(ValueError): c.validate_runtime(before, wrong)
        wrong = copy.deepcopy(after); wrong['Config']['Env'][0] = 'PRIVATE=changed'
        with self.assertRaises(ValueError): c.validate_runtime(before, wrong)
        wrong = copy.deepcopy(after); wrong['Mounts'][0]['RW'] = True
        with self.assertRaises(ValueError): c.validate_runtime(before, wrong)

    def test_service_is_bounded_and_unprivileged(self):
        service = Path(__file__).with_name('geupddong-origin-bots.service').read_text()
        for expected in ('User=geupddong-origin-bots', 'SupplementaryGroups=adm', 'CPUQuota=10%',
                         'MemoryMax=128M', 'NoNewPrivileges=yes', 'ReadOnlyPaths=/var/log/nginx'):
            self.assertIn(expected, service)
        installer = Path(__file__).with_name('install.sh').read_text()
        self.assertNotIn('systemctl enable', installer)
        self.assertNotIn('docker ', installer)


if __name__ == '__main__': unittest.main()
