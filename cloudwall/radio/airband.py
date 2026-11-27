"""RTLSDR-Airband's config, written from a plan.

RTLSDR-Airband (github.com/rtl-airband/RTLSDR-Airband) does the radio work CloudWall cannot in pure
Python: it reads the receiver's samples, demodulates every channel in a slice as AM, applies the
squelch, and hands out audio. CloudWall writes its config and reads what it hands out:

  * a slice heard at once ("multichannel"): each channel's audio as a UDP stream to a port of its
    own on this machine, sent only while the squelch is open, so a gap is the end of a call;
  * a list scanned ("scan"): one stream can't say which frequency it came from, so instead each
    call is written to a file of its own whose name carries the frequency, for CloudWall to pick up.

The option names are those of RTLSDR-Airband 5; check them against the version installed (its
config examples and wiki) before relying on them. Frequencies and rates are written in whole hertz,
which it reads as such.
"""
from .plan import DEVICES

BASE_PORT = 6001


def _value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if isinstance(v, (list, tuple)):
        return "( " + ", ".join(_value(x) for x in v) + " )"
    return str(v)


def _group(d, indent):
    pad = "  " * indent
    lines = []
    for k, v in d.items():
        if isinstance(v, dict):
            lines += [f"{pad}{k}: {{", *_group(v, indent + 1), f"{pad}}};"]
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            items = [f"{pad}  {{\n" + "\n".join(_group(x, indent + 2)) + f"\n{pad}  }}" for x in v]
            lines += [f"{pad}{k}: (", ",\n".join(items), f"{pad});"]
        else:
            lines.append(f"{pad}{k} = {_value(v)};")
    return lines


def _device(receiver, gain, correction):
    d = dict(DEVICES[receiver.kind]["airband"])
    if d["type"] == "rtlsdr":
        if receiver.serial:
            d["serial"] = receiver.serial       # two dongles of one make: set apart by rtl_eeprom -s
        else:
            d["index"] = receiver.index
    d["sample_rate"] = receiver.rate
    if gain is not None:
        d["gain"] = gain
    if correction:
        d["correction"] = correction          # the dongle's frequency error, in ppm
    return d


def ports(plan, base=BASE_PORT):
    """{port: channel} for every channel heard at once, in the order the config gives them."""
    return {base + i: c for i, c in enumerate(plan.heard)}


def config(plan, gain=None, correction=0, base_port=BASE_PORT, spool="/var/lib/cloudwall/radio",
           squelch_snr=None):
    """The whole config file for `plan`, as text.

    `gain`: a number (dB) or, for an Airspy, a SoapySDR gain string; None leaves it to the device.
    `squelch_snr`: the signal-to-noise ratio (dB) that opens the squelch; None, RTLSDR-Airband's own."""
    devices, port = [], base_port
    for s in plan.slices:
        d = _device(s.receiver, gain, correction)
        d["mode"] = "multichannel"
        d["centerfreq"] = s.center
        chans = []
        for c in s.channels:
            ch = {"freq": c.freq, "label": c.name, "outputs": [
                {"type": "udp_stream", "dest_address": "127.0.0.1", "dest_port": port, "continuous": False}]}
            if squelch_snr is not None:
                ch["squelch_snr_threshold"] = squelch_snr
            chans.append(ch)
            port += 1
        d["channels"] = chans
        devices.append(d)
    if plan.scan and plan.scanner:
        d = _device(plan.scanner, gain, correction)
        d["mode"] = "scan"
        ch = {"freqs": [c.freq for c in plan.scan], "labels": [c.name for c in plan.scan], "outputs": [
            {"type": "file", "directory": spool, "filename_template": "scan",
             "split_on_transmission": True, "include_freq": True}]}
        if squelch_snr is not None:
            ch["squelch_snr_threshold"] = squelch_snr
        d["channels"] = [ch]
        devices.append(d)
    head = ["# Written by CloudWall from its radio plan; changes here are lost when it is written again.",
            "# Run with: rtl_airband -f -c <this file>"]
    return "\n".join(head + _group({"devices": devices}, 0)) + "\n"
