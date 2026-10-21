#!/bin/sh
# Start the Good Splash Replacer service, or restart it when the installed app is a different version
# (an app reinstall leaves the old service running). Called by init.d at boot and by the app on launch.
D=$(cd "$(dirname "$0")" && pwd)
WANT=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$D/../appinfo.json")
PID=$(cat /tmp/goodsplash.pid 2>/dev/null)
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  [ "$(cat /tmp/goodsplash.ver 2>/dev/null)" = "$WANT" ] && exit 0
  kill "$PID"; sleep 1
else
  # A service from before 0.2.0 wrote no pid file; stop it so the new one can take the port.
  OLD=$(pgrep -f "$D/server.js")
  [ -n "$OLD" ] && kill $OLD && sleep 1
fi
cd "$D" && nohup node "$D/server.js" >/tmp/goodsplash.log 2>&1 &
