#!/bin/bash
# Rehearse moving a server from the old setup to this code, on real systemd, in a container:
#   bash tools/rehearse/run.sh [old-ref] [wait-seconds]
# old-ref: what the server runs now: a commit from before the system install, with the old
# per-user unit in deploy/ (default 3620533, the last such); the code moved to is the working tree.
# Needs Docker able to run a privileged container. Takes about four minutes (one is the watchdog's).
set -eu
cd "$(dirname "$0")/../.."
OLD=${1:-3620533}; WAIT=${2:-180}
git cat-file -e "$OLD:deploy/cloudwall.service" 2>/dev/null || { echo "$OLD has no deploy/cloudwall.service: name a commit from before the system install (and fetch it, in a shallow clone)"; exit 2; }
docker build -q -t cloudwall-rehearse ${DOCKER_BUILD_ARGS:-} tools/rehearse >/dev/null
docker rm -f cloudwall-rehearse >/dev/null 2>&1 || true
docker run -d --name cloudwall-rehearse --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  --tmpfs /run --tmpfs /run/lock cloudwall-rehearse >/dev/null
trap 'docker rm -f cloudwall-rehearse >/dev/null 2>&1' EXIT
sleep 5
git archive --prefix=CloudWall/ "$OLD" | docker exec -i cloudwall-rehearse tar -x -C /home/ubuntu
# the working tree as it stands, through an index of its own: what is staged here stays staged
IDX=$(mktemp); cp "$(git rev-parse --git-path index)" "$IDX"
NEW=$(GIT_INDEX_FILE="$IDX" git add -A && GIT_INDEX_FILE="$IDX" git write-tree); rm -f "$IDX"
git archive --prefix=CloudWall/ "$NEW" | docker exec -i cloudwall-rehearse sh -c 'cat > /tmp/new.tar'
docker cp tools/rehearse/inside.sh cloudwall-rehearse:/tmp/rehearse.sh
# settings as the server's might be: the receiver first and merged, a word an update checks harder, a private link
docker exec cloudwall-rehearse sh -c 'printf "[home]\nlat = 45.6362\nlon = -122.6775\n[source]\nurls = [\"http://127.0.0.1:18080/data/aircraft.json\", \"https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{radius}\"]\nmerge = true\n[flightradar24]\nmode = \"Always\"\n[server]\nkey = \"tafo-kemi-luza-nobe\"\n" > /home/ubuntu/CloudWall/config.toml; chmod 644 /home/ubuntu/CloudWall/config.toml'
docker exec -e WAIT="$WAIT" cloudwall-rehearse bash /tmp/rehearse.sh
