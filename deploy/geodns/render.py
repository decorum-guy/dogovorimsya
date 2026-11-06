#!/usr/bin/env python3
"""Render one identical authoritative GeoDNS zone for both nameservers."""

import argparse
import ipaddress
import json
import re
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--origin", required=True, type=ipaddress.IPv4Address)
    parser.add_argument("--edge", required=True, type=ipaddress.IPv4Address)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--serial", type=int, default=int(time.time()))
    args = parser.parse_args()
    domain = args.domain.rstrip(".").lower()
    if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
        parser.error("Expected an ASCII domain name")
    if not 0 < args.serial < 2**32:
        parser.error("SOA serial must fit in an unsigned 32-bit integer")
    origin, edge = str(args.origin), str(args.edge)
    records = {
        domain: [
            {"soa": f"ns1.{domain} hostmaster.{domain} {args.serial} 3600 600 1209600 60"},
            {"ns": {"content": f"ns1.{domain}", "ttl": 3600}},
            {"ns": {"content": f"ns2.{domain}", "ttl": 3600}},
        ],
        f"ns1.{domain}": [{"a": {"content": origin, "ttl": 3600}}],
        f"ns2.{domain}": [{"a": {"content": edge, "ttl": 3600}}],
        f"ru.route.{domain}": [{"a": origin}],
        f"default.route.{domain}": [{"a": edge}],
        f"_geodns.{domain}": [
            {"txt": '"IP Geolocation by DB-IP https://db-ip.com; CC BY 4.0"'}
        ],
    }
    targets = [f"%cc.route.{domain}", f"default.route.{domain}"]
    zones = {
        "domains": [{
            "domain": domain,
            "ttl": 60,
            "records": records,
            "services": {domain: targets, f"www.{domain}": targets},
        }],
    }
    args.output.mkdir(parents=True, exist_ok=True)
    # JSON is a YAML subset understood by PowerDNS; no PyYAML dependency needed.
    (args.output / "zones.yaml").write_text(json.dumps(zones, indent=2) + "\n")
    (args.output / "pdns.conf").write_text("""launch=geoip
geoip-database-files=/etc/dogovorimsya-dns/country.mmdb
geoip-zones-file=/etc/dogovorimsya-dns/zones.yaml
local-address=0.0.0.0
local-port=1053
socket-dir=/run/dogovorimsya-dns
daemon=no
guardian=no
disable-syslog=yes
loglevel=4
log-dns-queries=no
log-dns-details=no
webserver=no
api=no
primary=no
secondary=no
dnsupdate=no
disable-axfr=yes
edns-subnet-processing=yes
cache-ttl=0
query-cache-ttl=0
negquery-cache-ttl=0
receiver-threads=1
distributor-threads=1
max-tcp-connections=32
max-tcp-connections-per-client=5
max-tcp-connection-duration=10
max-tcp-transactions-per-conn=50
any-to-tcp=yes
udp-truncation-threshold=1232
version-string=anonymous
""")
    print(f"Rendered {domain}, serial {args.serial}: RU -> {origin}, default -> {edge}")


if __name__ == "__main__":
    main()
