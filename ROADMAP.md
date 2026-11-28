# CloudWall roadmap

The plan for making CloudWall and what grew around it one system: one program, one install, one
settings interface, one data layout on both machines; layers with defined seams so new radios,
decoders and AI processing plug in; fault-tolerant; explained to its owner in plain words.

Owner's decisions: server on the VPS, receiver at home; two access levels (owner, viewers); room
for more radios/decoders and transcripts/AI; help built in. Kept: Python standard library only; no
build step in the page; the display only draws; external programs (adsb.im, rtl_airband, ssh,
Caddy) are driven and supervised, never imported.

## Done

Stages 0 to 5b: the fixes in place, the seams, every module in its layer's folder
(ARCHITECTURE.md), `cloudwall install/upgrade/rollback/uninstall/doctor/backup/restore/report`,
the health watcher and problem catalogue, owner sign-in, the root helper, the settings schema and
the control board at `/admin`.

Removed from the tree since, to be rebuilt (or brought back from git history: commit 800894c is
the last with them) when their stage comes: the unwired airband radio package
(`cloudwall/radio`), the receiver-side helper scripts (`tools/adsb_check.sh`, `feeder_report.sh`,
`coverage3d_facts.sh`, `sharing_guide.py`), and the one-time move from the old per-user setup.

## To do

6. **Settings:** the config file generated from the schema (each setting's help as its comment),
   secrets in a 0600 file of their own, guided set-ups with a live check at each step (first run,
   pair a receiver, share data, go public), a glossary, a handbook for routine administration
   (one source for a Help tab and `cloudwall help <topic>`).
7. **Station** (`--role station`, on the Pi), in four parts:
   - one raw readsb reader (URL or file) keeping `rssi`, `nac_p`, `seen_pos`, `alt_geom` and the
     source type, exposed on one loopback, read-only HTTP port, with `/data/aircraft.json` at
     tar1090's path; no recording until the Pi's clock is synchronised;
   - the link managed from settings: units generated, a DNS name not a resolved IP, two-step
     pairing (the Pi prints one line; the VPS accepts it);
   - one receiver-facts module with one `mask()`; one `[station]` (position, ground elevation,
     antenna height, SDR serials and their jobs), which `[home]` may point at;
   - sharing set up as an on-demand owner tool with a one-time token, never a standing root web
     server.
8. **Coverage** folded in: sampling on the station, `coverage.db`, store-and-forward over the
   link; `coverage3d/` and its installer deleted.
9. **Radio:** a hardware session first; a Sensor interface (start, stop, health, settings)
   extracted from it, which UAT, ACARS/VDL2 and NOAA then follow; a calls store; a Radio tab;
   transcription through a work queue that is a table (`WHERE transcript IS NULL`).
10. **Docs** rewritten around the new shape, with an extension guide (adding a sensor, source,
    view or worker).

Work is in three classes: sensing (own receiver, coverage, radio) always runs; free gathering
(public feed, routes, weather) runs while watched, and slowly when not, so the logbook stays
complete; paid lookups run only while watched. Each machine is to keep a copy of the other's
backup through the link, with a written rebuild inventory for what a backup cannot hold (adsb.im's
own backup, SDR serials, DNS, firewall, panel autostart).

## Verification

- `python3 -m unittest discover -s tests` green at every stage; `cloudwall --demo` plus the
  browser smoke test after anything under `web/`.
- On the real machines (not possible from a cloud session; the owner runs these):
  `cloudwall doctor` on both after a stage, then a rebuild drill: backup, fresh install, restore.
