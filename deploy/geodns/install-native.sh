#!/usr/bin/env bash
# Run only by the owner after reviewing the prepared DNS directory.
set -euo pipefail

BASE="$1"
LISTEN_IP="$2"
if [[ "$EUID" != 0 ]]; then
  echo "Run this installer with sudo after reviewing it." >&2
  exit 1
fi
python3 - "$BASE" "$LISTEN_IP" <<'PY'
import ipaddress, pathlib, sys
base = pathlib.Path(sys.argv[1])
assert str(base) == "/home/codex/apps/dogovorimsya-dns"
assert base.is_dir() and not base.is_symlink()
assert base.resolve() == base
assert ipaddress.IPv4Address(sys.argv[2]).is_global
for name in ["config/pdns.conf", "config/zones.yaml", "config/country.mmdb", "powerdns-pub.asc"]:
    assert (base / name).is_file(), name
PY

. /etc/os-release
if [[ "$ID" != ubuntu || ! "$VERSION_CODENAME" =~ ^(jammy|noble)$ ]]; then
  echo "This installer is prepared for Ubuntu 22.04/24.04 only." >&2
  exit 1
fi
if systemctl is-active --quiet pdns.service; then
  echo "An existing default PowerDNS service is active; refusing to replace it." >&2
  exit 1
fi
if dpkg -s pdns-server >/dev/null 2>&1 && [[ ! -f "$BASE/.native-installed" ]]; then
  echo "PowerDNS is already installed outside this deployment; refusing to replace it." >&2
  exit 1
fi
if [[ -f /etc/systemd/system/dogovorimsya-dns.service ]] && [[ ! -f "$BASE/.native-installed" ]]; then
  echo "An unrecognized DNS unit already exists; refusing to replace it." >&2
  exit 1
fi

BACKUP="$BASE/backups/$(date -u +%Y%m%d-%H%M%S)"
install -d -m 0700 "$BACKUP"
if [[ -f /etc/systemd/system/dogovorimsya-dns.service ]]; then
  cp -a /etc/systemd/system/dogovorimsya-dns.service "$BACKUP/"
fi
if command -v ufw >/dev/null; then
  ufw status numbered > "$BACKUP/ufw-before.txt"
fi

# Trust this key only for the dedicated vendor repository, not globally.
install -d -m 0755 /etc/apt/keyrings
install -m 0644 "$BASE/powerdns-pub.asc" /etc/apt/keyrings/dogovorimsya-pdns.asc
cat > /etc/apt/sources.list.d/dogovorimsya-pdns.list <<EOF
deb [signed-by=/etc/apt/keyrings/dogovorimsya-pdns.asc] https://repo.powerdns.com/ubuntu $VERSION_CODENAME-auth-51 main
EOF
cat > /etc/apt/preferences.d/dogovorimsya-pdns <<'EOF'
Package: pdns-*
Pin: origin repo.powerdns.com
Pin-Priority: 600
EOF

# Prevent the package's unused default service from binding all port-53 addresses.
# Our separate unit listens only on the requested public IPv4 address.
systemctl mask pdns.service
apt-get update
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y --no-install-recommends pdns-server pdns-backend-geoip

cat > /etc/systemd/system/dogovorimsya-dns.service <<EOF
[Unit]
Description=Dogovorimsya authoritative GeoDNS
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=10

[Service]
Type=simple
User=codex
Group=codex
ExecStart=/usr/sbin/pdns_server --config-dir=/etc/dogovorimsya-dns --local-address=$LISTEN_IP --local-port=53
ExecReload=/usr/bin/pdns_control --socket-dir=/run/dogovorimsya-dns reload
Restart=always
RestartSec=3
RuntimeDirectory=dogovorimsya-dns
RuntimeDirectoryMode=0700
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=tmpfs
BindReadOnlyPaths=$BASE/config:/etc/dogovorimsya-dns
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ReadWritePaths=/run/dogovorimsya-dns
MemoryMax=128M
TasksMax=64

[Install]
WantedBy=multi-user.target
EOF

systemd-analyze verify /etc/systemd/system/dogovorimsya-dns.service
systemctl daemon-reload
systemctl enable --now dogovorimsya-dns.service
systemctl is-active --quiet dogovorimsya-dns.service
for attempt in 1 2 3 4 5; do
  if /usr/bin/pdns_control --socket-dir=/run/dogovorimsya-dns rping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
/usr/bin/pdns_control --socket-dir=/run/dogovorimsya-dns rping
if command -v ufw >/dev/null && ufw status | head -1 | grep -q 'Status: active'; then
  ufw allow proto udp to "$LISTEN_IP" port 53 comment 'Dogovorimsya authoritative DNS'
  ufw allow proto tcp to "$LISTEN_IP" port 53 comment 'Dogovorimsya authoritative DNS'
fi
touch "$BASE/.native-installed"
echo "DNS service started on $LISTEN_IP:53 (UDP and TCP)."
echo "Do not change registrar NS until both nameservers pass external checks."
