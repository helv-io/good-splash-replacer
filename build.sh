#!/bin/sh
# Builds io.helv.goodsplash_<version>_all.ipk with ar and tar, the same layout as webosbrew packages. Prints the file name.
set -e
cd "$(dirname "$0")"
V=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' app/appinfo.json)
ID=$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' app/appinfo.json)
B=$(mktemp -d)
A=$B/data/usr/palm/applications/$ID
mkdir -p "$A" "$B/ctrl"
cp -r app/. "$A/"
cp -r service "$A/service"
printf 'Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %s\nMaintainer: helv.io\nDescription: Good Splash Replacer\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: x.y.x\n' \
  "$ID" "$V" "$(du -sk "$B/data" | cut -f1)" > "$B/ctrl/control"
echo 2.0 > "$B/debian-binary"
(cd "$B/data" && tar --format=ustar --owner=0 --group=0 --sort=name -czf ../data.tar.gz usr)
(cd "$B/ctrl" && tar --format=ustar --owner=0 --group=0 -czf ../control.tar.gz control)
OUT="${ID}_${V}_all.ipk"
rm -f "$OUT"
(cd "$B" && ar rc "$OLDPWD/$OUT" debian-binary control.tar.gz data.tar.gz)
rm -rf "$B"
echo "$OUT"
