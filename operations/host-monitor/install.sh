#!/bin/sh
# Explicit installation only. Does not enable/start a timer or redeploy any service.
set -eu
[ "$(id -u)" = 0 ] || { printf '%s\n' 'Run this reviewed installer as root.' >&2; exit 1; }
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 --version >/dev/null
if ! id geupddong-monitor >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin geupddong-monitor
fi
install -d -m 0755 /opt/geupddong-host-monitor
install -m 0644 "$SOURCE/collect.py" /opt/geupddong-host-monitor/collect.py
install -d -o geupddong-monitor -g geupddong-monitor -m 0750 /var/snap/docker/common/geupddong-host-monitor
install -d -o geupddong-monitor -g geupddong-monitor -m 0750 /var/snap/docker/common/geupddong-host-monitor/exports
if [ ! -f /etc/geupddong-host-monitor.json ]; then
    install -o root -g geupddong-monitor -m 0640 "$SOURCE/config.example.json" /etc/geupddong-host-monitor.json
fi
install -m 0644 "$SOURCE/geupddong-host-monitor.service" /etc/systemd/system/geupddong-host-monitor.service
install -m 0644 "$SOURCE/geupddong-host-monitor.timer" /etc/systemd/system/geupddong-host-monitor.timer
systemctl daemon-reload
printf '%s\n' 'Installed only. Review config, then explicitly enable the timer and admin read-only mount.'
