#!/bin/sh
# Kept so a panel set up the old way keeps working: a desktop autostart that runs this script
# from a checkout (~/.config/labwc/autostart) still opens the board after an update.
# The way to set a panel up now is `sudo cloudwall install --role panel` (README.md, "A wall panel"),
# which writes /usr/local/bin/cloudwall-kiosk and its own autostart line; this script defers to it
# when it is there.
[ -x /usr/local/bin/cloudwall-kiosk ] && [ -r /etc/cloudwall/panel.conf ] && exec /usr/local/bin/cloudwall-kiosk
DIR=$(cd "$(dirname "$0")/.." && pwd)
if [ -z "$CLOUDWALL_URL" ] && [ -x "$DIR/.venv/bin/cloudwall" ]; then
  CLOUDWALL_URL=$(cd "$DIR" && .venv/bin/cloudwall --private-link url 2>/dev/null)
fi
URL=${CLOUDWALL_URL:-http://localhost:5050}/kiosk
until curl -sf "${URL%/kiosk}/api/state" >/dev/null; do sleep 2; done
BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --overscroll-history-navigation=0 --disable-pinch --autoplay-policy=no-user-gesture-required "$URL"
