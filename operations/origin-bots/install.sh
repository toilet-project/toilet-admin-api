#!/bin/sh
# Explicit installation only: no timer start, container restart, or log changes.
set -eu
[ "$(id -u)" = 0 ]
[ "${1:-}" = '--trusted-real-ip-confirmed' ] || {
  printf '%s\n' 'Verify Nginx proxy trust, then pass --trusted-real-ip-confirmed.' >&2
  exit 1
}
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for target in /opt/geupddong-origin-bots /var/snap/docker/common/geupddong-origin-bots /var/snap/docker/common/geupddong-origin-bots/state /var/snap/docker/common/geupddong-origin-bots/exports /etc/systemd/system/geupddong-origin-bots.service /etc/systemd/system/geupddong-origin-bots.timer; do
  [ ! -L "$target" ] || exit 1
done
python3 --version >/dev/null
if ! id geupddong-origin-bots >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --shell /usr/sbin/nologin geupddong-origin-bots
fi
getent passwd geupddong-origin-bots | grep -q ':/usr/sbin/nologin$'
# The adm membership exists only inside the service, not for interactive login.
install -d -o root -g root -m 0755 /opt/geupddong-origin-bots
install -o root -g root -m 0644 "$SOURCE/collect.py" /opt/geupddong-origin-bots/collect.py
install -d -o geupddong-origin-bots -g geupddong-origin-bots -m 0751 /var/snap/docker/common/geupddong-origin-bots
install -d -o geupddong-origin-bots -g geupddong-origin-bots -m 0700 /var/snap/docker/common/geupddong-origin-bots/state
install -d -o geupddong-origin-bots -g geupddong-origin-bots -m 0750 /var/snap/docker/common/geupddong-origin-bots/exports
install -o root -g root -m 0644 "$SOURCE/geupddong-origin-bots.service" /etc/systemd/system/geupddong-origin-bots.service
install -o root -g root -m 0644 "$SOURCE/geupddong-origin-bots.timer" /etc/systemd/system/geupddong-origin-bots.timer
systemctl daemon-reload
printf '%s\n' 'Installed only. Run the bounded service once, then enable its timer and read-only admin connection.'
