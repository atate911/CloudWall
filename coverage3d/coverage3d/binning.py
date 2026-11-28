"""Coverage bins: bearing sectors x altitude bands.

Raw points are summarised as histogram rows (SQL GROUP BY in the store, or `hist_rows` here);
rows from several ranges or days can simply be added together.

  dist row : (sector, band, dist_bucket, n, dmax_nm, rssi_min, t_min, t_max)
  rssi row : (sector, band, rssi_bucket, n)

dist_bucket = floor(nm); rssi_bucket = floor(dBFS). Band -1 is the "ground" band.
"""
from __future__ import annotations

import math
from collections import defaultdict

GROUND = -1


def n_sectors(sector_deg: int) -> int:
    return 360 // sector_deg


def n_bands(band_ft: int, max_alt_ft: int) -> int:
    return max(1, math.ceil(max_alt_ft / band_ft))


def sector_index(brg_deg: float, sector_deg: int) -> int:
    """Sector i spans [i*sector_deg, (i+1)*sector_deg) degrees true: sector 0 starts at north."""
    return int((brg_deg % 360.0) // sector_deg) % n_sectors(sector_deg)


def band_index(alt_ft: float, band_ft: int, max_alt_ft: int, ground: bool = False) -> int:
    """Below 0 -> band 0; above the maximum -> top band; ground -> GROUND."""
    if ground:
        return GROUND
    i = int(math.floor(alt_ft / band_ft)) if alt_ft > 0 else 0
    return min(max(i, 0), n_bands(band_ft, max_alt_ft) - 1)


def band_range_ft(i: int, band_ft: int) -> tuple[int, int]:
    return i * band_ft, (i + 1) * band_ft


def percentile(sorted_vals: list, p: float) -> float:
    """Linear-interpolated percentile (p in 0..100) of an already sorted list."""
    if not sorted_vals:
        raise ValueError("empty")
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p / 100.0
    lo, hi = math.floor(k), math.ceil(k)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def hist_rows(points, sector_deg: int, band_ft: int, max_alt_ft: int):
    """Python equivalent of the SQL aggregation. points: iterable of (brg, alt_ft, ground, dist_nm, rssi, t)."""
    dist = {}
    rssi = defaultdict(int)
    for brg, alt, ground, d, r, t in points:
        s = sector_index(brg, sector_deg)
        b = band_index(alt, band_ft, max_alt_ft, ground)
        key = (s, b, int(math.floor(d)))
        cur = dist.get(key)
        if cur is None:
            dist[key] = [1, d, r if r is not None else None, t, t]
        else:
            cur[0] += 1
            cur[1] = max(cur[1], d)
            if r is not None:
                cur[2] = r if cur[2] is None else min(cur[2], r)
            cur[3] = min(cur[3], t)
            cur[4] = max(cur[4], t)
        if r is not None:
            rssi[(s, b, int(math.floor(r)))] += 1
    d_rows = [(s, b, k, v[0], v[1], v[2], v[3], v[4]) for (s, b, k), v in dist.items()]
    r_rows = [(s, b, k, n) for (s, b, k), n in rssi.items()]
    return d_rows, r_rows


def _hist_percentile(buckets: list[tuple[int, int]], total: int, p: float, vmax: float) -> float:
    """buckets: sorted [(bucket_lower, n)], 1-wide. Interpolates inside the bucket; never exceeds vmax."""
    target = total * p / 100.0
    cum = 0
    for lo, n in buckets:
        if cum + n >= target:
            frac = (target - cum) / n if n else 0.0
            return min(lo + frac, vmax)
        cum += n
    return vmax


def build_bins(dist_rows, rssi_rows, min_points: int = 1) -> dict:
    """Combine histogram rows into {(sector, band): bin}; bins under min_points are dropped."""
    acc: dict = {}
    for s, b, bucket, n, dmax, rmin, tmin, tmax in dist_rows:
        a = acc.setdefault((s, b), {"n": 0, "dmax": 0.0, "rmin": None, "t0": tmax, "t1": tmin, "h": defaultdict(int)})
        a["n"] += n
        a["dmax"] = max(a["dmax"], dmax)
        if rmin is not None:
            a["rmin"] = rmin if a["rmin"] is None else min(a["rmin"], rmin)
        a["t0"] = min(a["t0"], tmin)
        a["t1"] = max(a["t1"], tmax)
        a["h"][bucket] += n
    rh: dict = defaultdict(lambda: defaultdict(int))
    for s, b, rb, n in rssi_rows:
        rh[(s, b)][rb] += n
    out = {}
    for key, a in acc.items():
        if a["n"] < min_points:
            continue
        p95 = _hist_percentile(sorted(a["h"].items()), a["n"], 95.0, a["dmax"])
        med = None
        if key in rh:
            items = sorted(rh[key].items())
            tot = sum(n for _, n in items)
            med = _hist_percentile(items, tot, 50.0, float("inf"))
        out[key] = {"count": a["n"], "max_nm": round(a["dmax"], 2), "p95_nm": round(p95, 2),
                    "rssi_med": None if med is None else round(med, 1),
                    "rssi_min": a["rmin"], "first": a["t0"], "last": a["t1"]}
    return out
