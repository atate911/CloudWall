#!/bin/sh
# Full-screen CloudWall on the Pi's display. Run from the desktop session's autostart, e.g.
# add a line with this script's path to ~/.config/labwc/autostart (Raspberry Pi OS Bookworm or later).
# With a private link set up (`make private-link`), it finds the key in CloudWall's config by itself;
# CLOUDWALL_URL (e.g. http://otherhost:5050/k/<key>) points it somewhere else.
DIR=$(cd "$(dirname "$0")/.." && pwd)
if [ -z "$CLOUDWALL_URL" ] && [ -x "$DIR/.venv/bin/cloudwall" ]; then
  CLOUDWALL_URL=$(cd "$DIR" && .venv/bin/cloudwall --private-link url 2>/dev/null)
fi
URL=${CLOUDWALL_URL:-http://localhost:5050}/kiosk
until curl -sf "${URL%/kiosk}/api/state" >/dev/null; do sleep 2; done
BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --overscroll-history-navigation=0 --disable-pinch --autoplay-policy=no-user-gesture-required "$URL"
