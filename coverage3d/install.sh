#!/usr/bin/env bash
# Coverage3D installer for the Raspberry Pi. Idempotent: safe to run again to update.
# Never touches the adsb.im containers. Usage:  sudo ./install.sh [--airports]
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/coverage3d
CONF_DIR=/etc/coverage3d
DATA_DIR=/var/lib/coverage3d
USER_NAME=coverage3d
WITH_AIRPORTS=0
[[ "${1:-}" == "--airports" ]] && WITH_AIRPORTS=1

[[ $EUID -eq 0 ]] || { echo "Run as root:  sudo $0" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 1; }
python3 - <<'PY' || { echo "Python 3.11 or newer is required" >&2; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)
PY
python3 -c "import venv, ensurepip" 2>/dev/null || { echo "Missing venv support: sudo apt install python3-venv" >&2; exit 1; }

echo "== user and directories"
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
install -d -m 0755 "$PREFIX" "$PREFIX/app" "$CONF_DIR"
install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" "$DATA_DIR"

echo "== application code -> $PREFIX/app"
rm -rf "$PREFIX/app/coverage3d"                       # drop stale files from older versions
cp -a "$SRC/coverage3d" "$PREFIX/app/coverage3d"
find "$PREFIX/app" -name __pycache__ -prune -exec rm -rf {} +
cp "$SRC/README.md" "$SRC/requirements.txt" "$PREFIX/"
chown -R root:root "$PREFIX/app"

echo "== virtualenv -> $PREFIX/venv (PEP 668: never system pip)"
[[ -x "$PREFIX/venv/bin/python" ]] || python3 -m venv "$PREFIX/venv"
if grep -qvE '^\s*(#|$)' "$SRC/requirements.txt"; then
  "$PREFIX/venv/bin/pip" install --quiet -r "$SRC/requirements.txt"
fi

echo "== configuration -> $CONF_DIR/config.toml"
if [[ -f "$CONF_DIR/config.toml" ]]; then
  cmp -s "$SRC/config.example.toml" "$CONF_DIR/config.toml" || \
    { cp "$SRC/config.example.toml" "$CONF_DIR/config.toml.new"; echo "   kept your config; new defaults are in config.toml.new"; }
else
  install -m 0644 "$SRC/config.example.toml" "$CONF_DIR/config.toml"
fi

if [[ $WITH_AIRPORTS -eq 1 ]]; then
  echo "== OurAirports list -> $DATA_DIR/airports.csv"
  curl -fsSL --max-time 60 -o "$DATA_DIR/airports.csv.tmp" https://davidmegginson.github.io/ourairports-data/airports.csv \
    && mv "$DATA_DIR/airports.csv.tmp" "$DATA_DIR/airports.csv" && chown "$USER_NAME:$USER_NAME" "$DATA_DIR/airports.csv" \
    || echo "   download failed; the bundled airport list will be used"
fi

echo "== systemd unit"
install -m 0644 "$SRC/coverage3d.service" /etc/systemd/system/coverage3d.service
systemctl daemon-reload

PORT=$(python3 - "$CONF_DIR/config.toml" <<'PY'
import sys, tomllib
try:
    print(tomllib.load(open(sys.argv[1], "rb")).get("server", {}).get("port", 8090))
except Exception:
    print(8090)
PY
)
if ! systemctl is-active --quiet coverage3d && ss -ltn "( sport = :$PORT )" 2>/dev/null | grep -q LISTEN; then
  echo "!! port $PORT is already in use (see: ss -ltn). Set [server] port in $CONF_DIR/config.toml, then:" >&2
  echo "   sudo systemctl enable --now coverage3d" >&2
  systemctl enable coverage3d >/dev/null 2>&1 || true
  exit 2
fi
systemctl enable coverage3d >/dev/null 2>&1
systemctl restart coverage3d
sleep 2
systemctl --no-pager --lines=5 status coverage3d || true
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "Coverage3D is running:  http://${IP:-<pi-ip>}:$PORT/      logs: journalctl -u coverage3d -f"
