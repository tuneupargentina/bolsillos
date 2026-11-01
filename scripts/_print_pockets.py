#!/usr/bin/env python3
import sys, re, json
t = sys.stdin.read()
m = re.search(r"\[\s*\{.*\}\s*\]", t, re.S)
if not m:
    print(t[-1500:])
    raise SystemExit(1)
arr = json.loads(m.group(0))
print(f"{'id':<10} {'share':>6} {'balance':>12} {'cap':>10}")
for p in arr:
    bal = int(p["balance"]) / 1e6
    cap_raw = int(p["daily_cap"])
    cap = cap_raw / 1e6 if cap_raw else 0
    cap_s = f"{cap:.0f}" if cap else "unlimited"
    print(f"{p['id']:<10} {p['share_bps']/100:5.1f}% {bal:10.0f} U {cap_s:>10}")
