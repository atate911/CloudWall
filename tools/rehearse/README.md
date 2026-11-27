# Rehearsing a server's move, on real systemd

`bash tools/rehearse/run.sh` builds a container like the server (Ubuntu 24.04, systemd as PID 1), sets
it up the old way (`make service` from `origin/main`: a per-user service from a checkout, the settings
in the checkout, a flyover in the logbook), pulls this working tree into the checkout and then, as the
owner would:

- `sudo python3 -m cloudwall upgrade`, and checks the old service is off, the logbook and the private
  link moved, the new service up as `Type=notify` with its watchdog, the board answering;
- `upgrade` again, which must move nothing;
- sets the owner's password, signs in to the control board, saves a setting, makes a backup, asks the
  root helper for a repair (it must run once, then go quiet), restarts from the board;
- leaves it running three minutes for the watchdog;
- updates and rolls back;
- runs `cloudwall doctor` without and with sudo.

Run it before a release. Read its output: it prints what it found rather than passing or failing.

`bash tools/rehearse/station.sh` does the same for a receiver's station, on the same image: the Pi's own
parts stood in for (`vcgencmd`, `lsusb`, a decoder, piaware's status, the tunnel's service), then
`install --role station`, the service as it runs, `station.json`, `cloudwall station --check`,
`cloudwall doctor`, `upgrade` (which must update the station and set up no wall) and `uninstall`.
Behind an HTTPS-only proxy, pass apt's way out:
`DOCKER_BUILD_ARGS="--build-arg APT_PROXY=http://127.0.0.1:3128 --build-arg CA=ca.crt --network host"`
(with the proxy's CA certificate copied into this folder as `ca.crt`).
