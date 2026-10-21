#!/bin/bash
# The checks every commit must pass, the same ones CI runs: syntax, unit tests (a skipped test fails), the ipk build.
set -euo pipefail
cd "$(dirname "$0")/.."
for f in app/*.js service/*.js tools/*.js test/*.js; do
  case "$f" in app/qrcode.js) continue;; esac
  node --check "$f"
done
python3 .agent-checks/bin/agent-checks no-skips -- node --test test/*.test.js
out=$(./build.sh)
ar t "$out" | tr '\n' ' ' | grep -q 'debian-binary control.tar.gz data.tar.gz' || { echo "error: $out is not a valid ipk"; exit 1; }
tar -xzOf <(ar p "$out" data.tar.gz) ./usr/palm/applications/io.helv.goodsplash/appinfo.json >/dev/null
echo "chk: ok ($out)"
