#!/bin/sh
# Full-screen CloudWall on the Pi's display. Run from the desktop session's autostart, e.g.
# add a line with this script's path to ~/.config/labwc/autostart (Raspberry Pi OS Bookworm or later).
until curl -sf http://localhost:8080/api/state >/dev/null; do sleep 2; done
BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --overscroll-history-navigation=0 --disable-pinch http://localhost:8080
