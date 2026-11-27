"""Every problem CloudWall knows how to recognise, written once: what it is, why it happens, what
it means for the owner, and what to do, step by step. A check that finds one names it by its code
(health.trouble("feeds.all-down", ...)); `cloudwall doctor`, the screens' warning, the control board's Home
page, the log and `cloudwall report` all take their words from here.

subtle: nothing looks wrong on the screens, but what they show is false (a frozen feed, a deaf
receiver, a clock or time zone that is off, sample data taken for real). These are found by
checking what the data should look like, not whether it arrives, and are said with "this looks
right but isn't" so the owner doesn't trust the screens meanwhile.

major: the problem stops CloudWall doing its main job (showing the sky over the house, or keeping
its logbook). Major problems are said loudly: an error in the log, a banner on every screen, the
service's status line, `cloudwall doctor`'s exit code, and the alert webhook if one is set.

repair: the name of a repair (operate/repair.py) that fixes it; "auto" ones CloudWall makes by
itself as soon as it sees the problem, the others `cloudwall doctor --fix` makes when asked.

To add a problem: an entry here, and a check that finds it. A test fails if a check names a code
that isn't here, or an entry lacks its steps.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Ask:
    """Something only the owner can tell CloudWall to fix a problem: `cloudwall doctor --fix` asks
    it at the terminal, and the control board as a form. kind says how the answer is checked and
    used: "place" (a ZIP code, or lat, lon), "secret" (typed unseen), "port", "timezone", "yes",
    "choice" (one of a setting's words) or "text"."""
    name: str
    question: str
    kind: str = "text"
    example: str = ""


@dataclass(frozen=True)
class Trouble:
    title: str                  # what is wrong, in a few words
    means: str                  # what it means for the owner
    causes: tuple = ()          # why it usually happens, most likely first
    steps: tuple = ()           # what to do, in order
    major: bool = False
    repair: str = None          # a repair's name in operate/repair.py
    auto: bool = False          # made by CloudWall itself, without asking
    subtle: bool = False        # the screens look right while showing something false: said as such
    asks: tuple = ()            # what the owner is asked, to fix it with them (Ask)


def _t(title, means, causes=(), steps=(), **kw):
    if "asks" in kw:
        kw["asks"] = tuple(kw["asks"])
    return Trouble(title, means, tuple(causes), tuple(steps), **kw)


CATALOGUE = {
    # -- settings ------------------------------------------------------------------------------
    "settings.broken": _t(
        "the settings file can't be used",
        "CloudWall is running on the last settings that started, or not at all: changes made since aren't in use.",
        ["a mistake made while editing it (a missing quote, text where a number goes)",
         "a setting this version of CloudWall no longer takes"],
        ["Run `cloudwall doctor`: it names the line and the setting.",
         "Correct it in the settings file (`sudoedit /etc/cloudwall/config.toml` on an install).",
         "Or undo the edit: copy config.toml.good back over config.toml.",
         "Restart CloudWall: `sudo systemctl restart cloudwall`."], major=True,
        asks=[Ask("restore", "Put back the last settings that started? (your edit is kept as config.toml.before)", "yes")]),
    "settings.ignored": _t(
        "a setting was left out",
        "CloudWall runs, with that setting at its default instead of what the file says.",
        ["a word it doesn't know (a typo), or a number out of range"],
        ["Change it to one of the values named, and restart CloudWall."],
        asks=[Ask("value", "What should it be? (one of the values named)", "choice")]),
    "settings.placeholder": _t(
        "the house's position is still the example's",
        "The board shows the sky over Vancouver, WA, not over your house.",
        ["the settings file was started from the example and [home] never set"],
        ["Set lat and lon (or zip) under [home] in the settings file.", "Restart CloudWall."],
        asks=[Ask("home", "Where is the house? A US ZIP code, or its latitude and longitude", "place", "98683, or 45.59, -122.47")]),
    "settings.readable": _t(
        "the settings file holds keys and anyone on this machine can read it",
        "Another account here could copy the private link or the paid provider's key.",
        ["it was made before CloudWall wrote its files readable by their owner only"],
        ["`cloudwall doctor --fix`, or `chmod o-r` the file."], repair="chmod-config"),
    "settings.changed": _t(
        "the settings file changed and isn't in use yet",
        "The new settings take effect when CloudWall restarts.",
        ["the file was edited while CloudWall was running"],
        ["Restart CloudWall when it suits: `sudo systemctl restart cloudwall`."]),
    "settings.changed-broken": _t(
        "the settings file was changed and the change can't be used",
        "CloudWall goes on with the settings it started with, but would not start again with this file.",
        ["a mistake made while editing it"],
        ["Correct what `cloudwall doctor` names before CloudWall next restarts (or a power cut restarts it).",
         "Or copy config.toml.good back over config.toml to undo the edit."], major=True),

    # -- storage -------------------------------------------------------------------------------
    "storage.full": _t(
        "the disk is full",
        "Flyovers and the heatmap aren't being saved, and other programs on this machine may fail too.",
        ["old backups, logs or downloads", "the map tile cache set larger than the disk"],
        ["See what is big: `sudo du -xh / | sort -h | tail -20`.",
         "Old backups: /var/lib/cloudwall/backups (the last 7 are kept).",
         "Lower [map] cache_mb; CloudWall trims the tiles to it itself.",
         "System logs: `sudo journalctl --vacuum-size=200M`."], major=True, repair="trim-cache", auto=True),
    "storage.low": _t(
        "the disk is nearly full",
        "Nothing is lost yet; at this rate it soon will be.",
        ["old backups, logs or downloads"],
        ["Free some space before it runs out (see `cloudwall help storage`)."], repair="trim-cache", auto=True),
    "storage.failing": _t(
        "the logbook can't be saved",
        "The board carries on, but flyovers and the heatmap are lost while this lasts.",
        ["the disk is full", "the logbook's file or folder isn't the service's to write",
         "the file is damaged"],
        ["Run `cloudwall doctor`: it says which.", "`cloudwall doctor --fix` gives the files back to the service."],
        major=True, repair="reopen-store", auto=True),
    "storage.unwritable": _t(
        "CloudWall's files aren't the service's to write",
        "Logbooks, the heatmap and settings changes can't be saved.",
        ["files copied in or restored as root", "a folder made by hand"],
        ["`sudo cloudwall doctor --fix` gives them back to the service's user."], major=True, repair="fix-ownership"),
    "storage.damaged": _t(
        "a logbook file is damaged",
        "CloudWall moves it aside and starts a new one when it next starts; the old one is kept beside it.",
        ["a power cut or a full disk while it was being written"],
        ["Restore the latest backup: `cloudwall restore <file> --yes`.",
         "Or keep the fresh start; the damaged file stays as <name>.damaged-<time> for recovery by hand."]),
    "storage.set-aside": _t(
        "a damaged logbook was set aside and a new one started",
        "The logbook's history is in the file set aside, not on the screens.",
        ["a power cut or a full disk while it was being written"],
        ["Restore the latest backup (`cloudwall restore <file> --yes`) to get the history back."]),

    # -- positions -----------------------------------------------------------------------------
    "feeds.no-positions": _t(
        "no positions are arriving",
        "The screens show no aircraft: the board is offline.",
        ["every feed is failing (this machine's internet, or the feeds themselves)",
         "your receiver and the tunnel to it are down, with no public feed to fall back on"],
        ["Run `cloudwall doctor`: it tries each feed and says which answer.",
         "Check this machine reaches the internet: `curl -sI https://opendata.adsb.fi`.",
         "If only your receiver is in [source] urls, add a public feed after it."], major=True),
    "feeds.receiver-down": _t(
        "your receiver isn't answering",
        "CloudWall carries on with the public feeds, a few seconds behind and without what only your receiver hears.",
        ["the receiver is off or its decoder has stopped", "the tunnel from the receiver is down",
         "the receiver's address changed"],
        ["On the receiver: `sudo bash tools/adsb_check.sh`.",
         "The tunnel: `systemctl status adsb-tunnel` on the receiver, `bash deploy/feed-tunnel/vps-tunnel.sh status` here.",
         "Then `cloudwall doctor` here."]),
    "feeds.public-down": _t(
        "a public feed isn't answering",
        "CloudWall moves on to the next feed in [source] urls.",
        ["the community feed is down or has changed its address"],
        ["Usually passes within the hour.", "If it lasts a day, take it out of [source] urls."]),
    "feeds.stale": _t(
        "a feed answers with old data",
        "Its web server is up but its decoder has stopped, so its aircraft are frozen or missing.",
        ["the receiver's decoder (readsb) stopped or lost its SDR"],
        ["On the receiver: `sudo bash tools/adsb_check.sh`; it names a stopped container.",
         "Restarting the receiver usually brings it back."]),

    # -- routes --------------------------------------------------------------------------------
    "routes.key-rejected": _t(
        "the paid route provider refuses the key",
        "Routes come from the free database meanwhile, which is sometimes wrong.",
        ["the key was changed or revoked", "the subscription ended"],
        ["Check the key in your Flightradar24 / FlightAware account.",
         "Put the new key in the settings, and restart CloudWall."],
        asks=[Ask("key", "The new key, from your account (typed unseen; Enter leaves it as it is)", "secret")]),
    "routes.budget-low": _t(
        "the paid lookups will run out before the plan renews",
        "When they do, routes come from the free database until the plan renews.",
        ["more traffic than the budget was set for", "a smaller plan"],
        ["Raise [flightradar24] safety_margin to spread them thinner, or set mode = \"fallback\"."]),

    # -- the clock -----------------------------------------------------------------------------
    "clock.unsynced": _t(
        "the clock isn't synchronised",
        "Positions are timed by the clock: a wrong one makes aircraft jump, or look stale and vanish.",
        ["no time server reachable", "time sync turned off"],
        ["`sudo timedatectl set-ntp true`.", "Check this machine reaches the internet."]),
    "clock.skew": _t(
        "this machine's clock and a feed's disagree",
        "Aircraft from that feed are placed a few seconds wrong, or dropped as stale.",
        ["this machine's clock (or the receiver's) is off"],
        ["`timedatectl` on each machine; `sudo timedatectl set-ntp true` where it isn't synchronised."]),

    # -- the service and the install -----------------------------------------------------------
    "service.down": _t(
        "the CloudWall service isn't running",
        "No screen gets anything.",
        ["it failed at start (see its log)", "it was stopped by hand"],
        ["See why: `journalctl -u cloudwall -n 50`.", "Fix what it says, then `sudo systemctl restart cloudwall`."],
        major=True, repair="restart-service"),
    "service.disabled": _t(
        "the CloudWall service won't start at boot",
        "After a reboot or a power cut the board stays dark until someone starts it.",
        ["it was disabled by hand"],
        ["`sudo systemctl enable cloudwall`."], repair="enable-service"),
    "service.duplicate": _t(
        "two CloudWalls are set up on this machine",
        "They fight over the port: one fails, and which one runs can change at each boot.",
        ["the old per-user service (`make service`) was left on after the system install"],
        ["`sudo python3 -m cloudwall upgrade` (from the checkout) moves the old one's logbooks in and turns it off."], major=True,
        asks=[Ask("migrate", "Move the old per-user CloudWall's logbooks into the system install and turn it off?", "yes")]),
    "service.legacy": _t(
        "CloudWall runs as the old per-user service",
        "It works, but lives in a home folder: a rebuild or a new machine means setting it up by hand again.",
        ["it was set up with `make service`, before `cloudwall install` existed"],
        ["From the checkout: `sudo python3 -m cloudwall upgrade --dry-run` to see what it would do, then "
         "`sudo python3 -m cloudwall upgrade` (MIGRATION.md walks through it)."],
        asks=[Ask("migrate", "Move it to the system install now? (logbooks and settings come too)", "yes")]),
    "service.no-linger": _t(
        "the per-user service won't start after a reboot",
        "It runs only while its user is logged in: after a reboot or power cut the board stays dark.",
        ["`loginctl enable-linger` failed when it was set up (the old Makefile ignored that)"],
        ["`sudo loginctl enable-linger <user>` (or move to the system install: `sudo python3 -m cloudwall upgrade`)."],
        repair="enable-linger"),
    "service.restart-needed": _t(
        "CloudWall's code was updated but the old version is still running",
        "Screens load the new pages from the old server, so anything new doesn't work yet.",
        ["an update (`git pull`, or new files) without a restart"],
        ["`sudo cloudwall install` (from the new code), or `sudo systemctl restart cloudwall`."]),
    "service.crashing": _t(
        "part of CloudWall keeps failing and being restarted",
        "It recovers each time, but something in it is wrong.",
        ["a fault in CloudWall, or data it didn't expect"],
        ["`cloudwall report` and the log (`journalctl -u cloudwall -n 200`) show where: report it with those."]),
    "server.port-taken": _t(
        "another program has CloudWall's port",
        "CloudWall can't answer the screens.",
        ["a second CloudWall (an old per-user one), or another program on the same port"],
        ["See which: `sudo ss -ltnp | grep :5050`.", "Stop it, or move CloudWall to another [server] port."],
        major=True,
        asks=[Ask("port", "A port for CloudWall instead (screens and bookmarks will need it too)", "port", "5051")]),
    "server.not-answering": _t(
        "nothing answers on CloudWall's port",
        "The screens can't reach it.",
        ["CloudWall isn't running", "it is on another port"],
        ["Start it (`sudo systemctl start cloudwall`), and check [server] port."]),

    # -- access --------------------------------------------------------------------------------
    "access.open": _t(
        "CloudWall is on the internet with nothing to keep strangers out",
        "Anyone who finds the address can watch, add places and spend paid lookups.",
        ["it listens on every address with no private link, on a machine reachable from the internet"],
        ["`sudo cloudwall --private-link`, or firewall the port so only Caddy reaches it."]),
    "access.key-in-log": _t(
        "the private link's key is in the service's old log",
        "Older CloudWall wrote it at every start; anyone who can read the log has the link.",
        ["a CloudWall from before the key was kept out of the log"],
        ["Make a new key: `sudo cloudwall --private-link new` (open the new link on each screen).",
         "Optionally clear old logs: `sudo journalctl --rotate --vacuum-time=1s`."],
        asks=[Ask("rotate", "Make a new private link now? Every screen will need the new link", "yes")]),
    # -- the receiver, the tunnel and what else was set up around CloudWall ---------------------
    "receiver.moved": _t(
        "the receiver says it is somewhere else",
        "Distances and directions from your receiver's data are worked out from the wrong place.",
        ["the receiver's location was set wrongly (or [home] was)"],
        ["Check the location in adsb.im's setup page against [home]."]),
    # -- the receiver's own machine (sense/station.py: a CloudWall station on the receiver) --------
    "receiver.undervoltage": _t(
        "the receiver's power supply is too weak",
        "The Pi's voltage has dropped: the USB stick can drop out, the SD card can be corrupted, and reception comes and goes.",
        ["a phone charger or a thin USB cable instead of the Pi's own power supply",
         "the receiver stick (a Pro Stick draws real current) and other USB devices on top"],
        ["Use the official Raspberry Pi power supply for its model, plugged straight in.",
         "Use a powered USB hub for anything else on USB.",
         "Then reboot the receiver: under-voltage since it started is only cleared by a restart."]),
    "receiver.throttled": _t(
        "the receiver is slowing itself down",
        "The Pi is running slower than it should to protect itself, from heat or a weak power supply: it may miss messages.",
        ["too hot (no airflow, a closed case in the sun)", "a weak power supply"],
        ["Check its temperature and power on this page.", "Give it airflow, a heatsink, or a case with a fan."]),
    "receiver.hot": _t(
        "the receiver is running hot",
        "Above 80 °C the Pi slows itself down, and a stick that gets hot drifts and hears less.",
        ["a closed case, in the sun or an attic", "no heatsink or fan"],
        ["Move it somewhere cooler or shaded, or give it a heatsink or a fan."]),
    "receiver.clock": _t(
        "the receiver's clock isn't synchronised",
        "Positions look normal, but MLAT (aircraft placed by timing, without ADS-B) needs an accurate clock: they can be wrong or missing.",
        ["no network time service running", "the network blocks NTP (UDP port 123)"],
        ["On the receiver: `timedatectl` (it should say \"System clock synchronized: yes\").",
         "`sudo timedatectl set-ntp true`, then wait a few minutes."], subtle=True),
    "receiver.disk": _t(
        "the receiver's SD card is nearly full",
        "When it fills, the decoder and the feeders can stop, and the card can be corrupted.",
        ["logs that grew (often from a feeder failing over and over)", "old images or files left behind"],
        ["On the receiver: `sudo journalctl --vacuum-size=100M` and `df -h /`.",
         "adsb.im: its setup page's System tab can clear its logs."]),
    "receiver.no-sdr": _t(
        "no receiver stick on the receiver's USB",
        "Without the USB stick there's nothing to hear: no positions come from your receiver.",
        ["the stick came loose or failed", "a weak power supply made it drop out"],
        ["Check the stick is firmly in, and that the Pi's power supply is the right one.",
         "Unplug it and plug it back in, then restart the decoder (or the receiver)."]),
    "receiver.dvb-driver": _t(
        "the TV-tuner driver can take the receiver stick",
        "Linux's own TV driver may grab the stick before the decoder does; then the decoder hears nothing.",
        ["the driver isn't blacklisted on this system"],
        ["On the receiver: `echo blacklist dvb_usb_rtl28xxu | sudo tee /etc/modprobe.d/rtl-sdr-blacklist.conf`, then reboot."]),
    "receiver.service-failed": _t(
        "a service on the receiver has stopped",
        "The decoder or a feeder isn't running: your receiver's positions, or its data sharing, stop with it.",
        ["it crashed and gave up restarting", "the stick it needs is missing"],
        ["On the receiver: `systemctl status <the service>` and `journalctl -u <the service> -n 50`.",
         "Restart it: `sudo systemctl restart <the service>` (adsb.im: its setup page restarts its containers)."]),
    "receiver.no-decoder": _t(
        "no decoder's data on the receiver",
        "Nothing decodes what the stick hears: no positions come from your receiver.",
        ["the decoder (readsb, dump1090-fa, or adsb.im's ultrafeeder) isn't running", "adsb.im's set-up wasn't finished"],
        ["On the receiver: `sudo bash tools/adsb_check.sh` names what is and isn't running.",
         "adsb.im: open its setup page at home and finish or restart it."]),
    "receiver.decoder-stuck": _t(
        "the receiver's decoder has stopped updating",
        "Its web server still answers, so it looks alive, but the aircraft in its data are old.",
        ["the decoder hung", "the stick stopped delivering samples"],
        ["Restart the decoder: `sudo systemctl restart readsb` (or dump1090-fa; adsb.im: `sudo docker restart ultrafeeder`)."],
        subtle=True),
    "receiver.feeder-down": _t(
        "a feeder on the receiver isn't connected",
        "Your receiver's data isn't reaching that site: its statistics stop, and so may the free account it gives you.",
        ["the receiver's internet is down", "the feeder's key or account was changed", "the feeder's service stopped"],
        ["On the receiver: `piaware-status` (FlightAware) or `fr24feed-status` (Flightradar24).",
         "adsb.im: its setup page shows each feeder's state."]),
    "receiver.station-down": _t(
        "the receiver's CloudWall station isn't answering",
        "This page can't see the receiver's power, temperature, clock, SD card, stick or feeders any more.",
        ["the station's service stopped", "the tunnel no longer carries its port"],
        ["On the receiver: `systemctl status cloudwall-station`.",
         "Is the tunnel up? On the receiver: `sudo bash deploy/feed-tunnel/pi-tunnel.sh status`."]),
    "tunnel.down": _t(
        "the tunnel from the receiver is down",
        "CloudWall here gets only the public feeds.",
        ["the receiver or its internet is down", "the tunnel's service on the receiver stopped",
         "this server's SSH host key or address changed"],
        ["On the receiver: `systemctl status adsb-tunnel` and `journalctl -u adsb-tunnel -n 30`.",
         "Here: `bash deploy/feed-tunnel/vps-tunnel.sh status`."]),
    "tunnel.unrestricted": _t(
        "the tunnel's key isn't restricted",
        "If the receiver's key were stolen it could do more on this server than open the one port.",
        ["authorized_keys was edited by hand (the old Coverage3D notes said to)"],
        ["Run `sudo bash deploy/feed-tunnel/vps-tunnel.sh setup \"<the receiver's key>\"` again: it writes the restrictions back."]),
    "tunnel.no-keepalive": _t(
        "a dropped tunnel can hold its port for minutes",
        "After a drop the receiver can't reconnect until the dead session times out.",
        ["this server's SSH doesn't check the tunnel's sessions are alive"],
        ["`sudo cloudwall doctor --fix` adds a keepalive for the tunnel's account."], repair="tunnel-keepalive"),
    "caddy.auth-removed": _t(
        "Caddy's password for CloudWall was commented out",
        "The private link is all that keeps CloudWall private on the internet.",
        ["an early `--public` set-up did this on purpose"],
        ["Keep the private link (it is checked here), or put basic_auth back in the Caddyfile."]),
    "caddy.down": _t(
        "Caddy isn't running",
        "CloudWall's address on the internet doesn't answer.",
        ["it failed to start (often a mistake in the Caddyfile)"],
        ["`sudo caddy validate --config /etc/caddy/Caddyfile`, then `sudo systemctl restart caddy`."], major=True),
    "coverage3d.separate": _t(
        "Coverage3D is installed as a program of its own",
        "It works, but is set up and updated apart from CloudWall.",
        ["it was installed from its own branch before it was folded in"],
        ["Leave it for now: it is folded into CloudWall in a later stage (ROADMAP.md)."]),
    "sharing.root-page": _t(
        "the sharing page is running as root on the network",
        "Anyone on the home network can change the receiver's data sharing through it.",
        ["it was started by hand and left running"],
        ["Stop it (Ctrl-C where it was started, or `sudo pkill -f sharing_guide.py`) when you're done with it."]),

    # -- subtle: the screens look right, but aren't -------------------------------------------------
    "feeds.frozen": _t(
        "a feed keeps giving the same answer",
        "Its aircraft look fine but have stopped moving or updating: what the screens show is old.",
        ["the receiver's decoder hung while its web server goes on", "a proxy or cache in between serving a stored copy"],
        ["On the receiver: `sudo bash tools/adsb_check.sh`.", "Restart the receiver's decoder (or the receiver)."],
        subtle=True),
    "receiver.deaf": _t(
        "your receiver answers but hears almost nothing",
        "It is up and answering, so nothing looks wrong, but the aircraft on the screens come from the public feeds alone.",
        ["the antenna or its cable is disconnected or damaged", "the SDR failed or its gain is set far too low",
         "the receiver is set to a frequency other than 1090 MHz"],
        ["On the receiver: `sudo bash tools/adsb_check.sh` (it shows the message rate and signal).",
         "Check the antenna's cable at both ends.", "Unplug the SDR and plug it back in, then restart the receiver."],
        subtle=True),
    "receiver.lagging": _t(
        "your receiver's positions are old by the time they arrive",
        "Aircraft from your receiver are drawn where they were seconds ago.",
        ["the link from the receiver is slow or congested", "the receiver is overloaded"],
        ["`cloudwall doctor` times the receiver's answers.", "On the receiver: check its CPU load (`uptime`)."],
        subtle=True),
    "clock.timezone": _t(
        "this machine's time zone isn't the house's",
        "The logbook's days, today's count and the wall panel's quiet hours follow this machine's clock, not the house's.",
        ["a server (a VPS) set to UTC"],
        ["Set the house's time zone: `sudo timedatectl set-timezone America/Los_Angeles` (yours), then restart CloudWall."],
        subtle=True,
        asks=[Ask("zone", "The house's time zone", "timezone", "America/Los_Angeles")]),
    "routes.sandbox": _t(
        "the paid routes are sample data",
        "Origins and destinations on the flight card look real but are Flightradar24's fixed examples.",
        ["[flightradar24] sandbox = true was left on after trying it out"],
        ["Set sandbox = false (with your real key) and restart CloudWall."], subtle=True),
    "display.demo": _t(
        "the screens show simulated traffic",
        "Every aircraft on the screens is made up.",
        ["CloudWall was started with --demo"],
        ["Start it without --demo (check the service's command: `systemctl cat cloudwall`)."], subtle=True),
    "weather.stale": _t(
        "the airport's weather report is old",
        "The weather shown looks current but is hours old.",
        ["the airport stopped sending reports", "fetching them keeps failing"],
        ["Usually passes; if it lasts, check [airport] is an airport that reports weather."], subtle=True),
    "home.suspect": _t(
        "no aircraft ever comes close to the house",
        "Hours of traffic, and none passed near: the house's position is probably wrong, so nothing is ever overhead or logged.",
        ["[home] lat/lon swapped, mistyped, or left as the example's"],
        ["Check [home] against a map (lat is about 45 for Portland, lon about -122).", "Restart CloudWall after fixing it."],
        subtle=True),

    # -- anticipating ------------------------------------------------------------------------------
    "backup.none": _t(
        "there is no recent backup",
        "If this machine's disk failed, the logbooks and settings would be gone.",
        ["backups have to be made (nothing makes them on a schedule yet)"],
        ["`sudo cloudwall backup`, and copy the file somewhere else."],
        asks=[Ask("backup", "Make a backup now?", "yes")]),
    "cache.over": _t(
        "the map cache is over its limit",
        "It is trimmed once a day; well over means the trimming isn't running.",
        ["the trimming failed (see the log)"],
        ["`cloudwall doctor --fix` trims it now."], repair="trim-cache", auto=True),
}
