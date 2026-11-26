"""The radio pieces from the command line, for trying them on real hardware.

  python3 -m cloudwall.radio plan --frequencies airport-frequencies.csv KPDX KVUO
  python3 -m cloudwall.radio plan ... --receiver rtlsdr --receiver rtlsdr --config rtl_airband.conf
  python3 -m cloudwall.radio listen --frequencies airport-frequencies.csv KPDX --save calls/

`plan` prints which channels each receiver can hear at once and writes RTLSDR-Airband's config;
`listen` makes the same plan, hears the UDP streams of the rtl_airband started with that config,
and prints a line for each call (saving it as a WAV with --save).

airport-frequencies.csv is OurAirports' table:
https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv
"""
import argparse
import threading
import time
from pathlib import Path

from . import airband, channels, plan


def _plan(args):
    text = Path(args.frequencies).read_text(encoding="utf-8")
    chans = channels.from_ourairports(text, args.airports)
    if not args.no_guard:
        chans = channels.with_guard(chans)
    if args.within:
        spans = []
        for w in args.within:
            lo, _, hi = w.partition("-")
            spans.append((round(float(lo) * 1e6), round(float(hi) * 1e6)))
        chans = [c for c in chans if any(lo <= c.freq <= hi for lo, hi in spans)]
    if not chans:
        raise SystemExit(f"No airband frequencies for {', '.join(args.airports)} in {args.frequencies}")
    given = [r.partition(":") for r in args.receiver or ["rtlsdr"]]
    kinds = [kind for kind, _, _ in given]
    for kind in kinds:
        if kind not in plan.DEVICES:
            raise SystemExit(f"--receiver {kind}: not one of {', '.join(sorted(plan.DEVICES))}")
    receivers = [plan.Receiver(kind, kinds[:i].count(kind), serial=serial)
                 for i, (kind, _, serial) in enumerate(given)]
    scanner = None
    if args.scan:
        scanner, receivers = receivers[-1], receivers[:-1]
    return plan.make_plan(chans, receivers, scanner)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python3 -m cloudwall.radio", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "listen"):
        p = sub.add_parser(name)
        p.add_argument("airports", nargs="+", help="ICAO idents whose frequencies to hear")
        p.add_argument("--frequencies", required=True, help="OurAirports' airport-frequencies.csv")
        p.add_argument("--receiver", action="append", metavar="KIND[:SERIAL]",
                       help=f"a receiver, once for each: {', '.join(sorted(plan.DEVICES))}, an RTL-SDR "
                            "optionally with its serial number (default: one rtlsdr)")
        p.add_argument("--scan", action="store_true",
                       help="give the last receiver the job of scanning what the others can't hear")
        p.add_argument("--no-guard", action="store_true", help="leave out 121.5")
        p.add_argument("--within", action="append", metavar="LO-HI",
                       help="only the frequencies in this range of MHz (118.0-120.2); once for each range")
        p.add_argument("--port", type=int, default=airband.BASE_PORT, help="the first channel's UDP port")
    sub.choices["plan"].add_argument("--config", help="write RTLSDR-Airband's config here")
    sub.choices["plan"].add_argument("--gain", type=float)
    sub.choices["plan"].add_argument("--ppm", type=int, default=0, help="the dongle's frequency error")
    sub.choices["listen"].add_argument("--save", help="a folder to save each call in, as a WAV")
    args = ap.parse_args(argv)

    p = _plan(args)
    if args.cmd == "plan":
        print(plan.describe(p))
        if args.config:
            Path(args.config).write_text(airband.config(p, gain=args.gain, correction=args.ppm,
                                                        base_port=args.port))
            print(f"\nWrote {args.config}")
        return

    save = Path(args.save) if args.save else None
    if save:
        save.mkdir(parents=True, exist_ok=True)

    def on_call(tx):
        stamp = time.strftime("%H:%M:%S", time.localtime(tx.start))
        line = f"{stamp}  {tx.channel.mhz}  {tx.channel.name:<28} {tx.duration:5.1f} s  {tx.level_db:6.1f} dB"
        if save:
            f = save / f"{time.strftime('%Y%m%d-%H%M%S', time.localtime(tx.start))}-{tx.channel.mhz}.wav"
            f.write_bytes(tx.wav())
            line += f"  {f.name}"
        print(line, flush=True)

    from .listen import listen
    stop = threading.Event()
    ports = airband.ports(p, args.port)
    print(f"Listening on UDP {min(ports)}-{max(ports)} for {len(ports)} channels; Ctrl-C to stop")
    try:
        listen(ports, on_call, stop)
    except KeyboardInterrupt:
        stop.set()


if __name__ == "__main__":
    main()
