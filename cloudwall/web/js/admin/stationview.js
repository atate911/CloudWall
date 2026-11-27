// A station's machine, drawn the same wherever it appears (the ADS-B page, the Stations page): a
// row for each part it reports, with its state's dot, and the commands to run on it.
import { el, esc, num, ago, lasted, bytes } from "./core.js";
import { line, advanced } from "./controls.js";
import { copyable } from "./parts.js";

const dot = (st) => `<span class="dot ${st}"></span>`;
export const JOBS = [["adsb", "ADS-B"], ["vhf", "VHF radio"], ["spare", "Spare"]];

/** Rows for what a station's machine says about itself (sense/station.py's facts). */
export function machineRows(f) {
  const rows = [];
  const up = f.uptime_s != null ? lasted(f.uptime_s) : null;
  rows.push(line("Machine", `<span class="line-val">${esc(f.board || f.host || "Receiver")}</span>
    <span class="dim small">${[f.host, f.os, f.image ? `${f.image} image` : "", up ? `up ${up}` : "", f.cloudwall ? `CloudWall ${f.cloudwall}` : ""].filter(Boolean).map(esc).join("; ")}</span>`));
  if (f.throttled != null) {
    const now = f.throttled & 0x1, since = f.throttled & 0x10000, slow = f.throttled & 0x4;
    rows.push(line("Power", `<span class="line-val">${dot(now ? "fail" : since ? "warn" : "ok")} ${now ? "Under-voltage now" : since ? "Under-voltage has happened since it started" : "No under-voltage since it started"}</span>
      ${slow ? `<span class="dim small">It is slowing itself down now (heat or power).</span>` : ""}`));
  }
  if (f.temp_c != null) rows.push(line("Temperature", `<span class="line-val">${dot(f.temp_c >= 80 ? "fail" : f.temp_c >= 70 ? "warn" : "ok")} ${num(f.temp_c)} °C</span>`));
  if (f.clock_synced != null) rows.push(line("Clock", `<span class="line-val">${dot(f.clock_synced ? "ok" : "warn")} ${f.clock_synced ? "Synchronised" : "Not synchronised: MLAT positions need it"}</span>`));
  if (f.disk?.total) {
    const used = 100 * (1 - f.disk.free / f.disk.total);
    rows.push(line("SD card", `<span class="line-val">${dot(used >= 97 ? "fail" : used >= 90 ? "warn" : "ok")} ${num(used)}% used</span>
      <span class="meter-bar"><i style="width:${used.toFixed(1)}%" class="${used >= 90 ? "warn" : ""}"></i></span><span class="dim small">${bytes(f.disk.free)} free of ${bytes(f.disk.total)}</span>`));
  }
  if (f.memory?.total) rows.push(line("Memory", `<span class="line-val">${bytes(f.memory.available)} free</span><span class="dim small">of ${bytes(f.memory.total)}${f.load ? `; load ${f.load.map((x) => x.toFixed(2)).join(", ")} on ${f.cpus || "?"} cores` : ""}</span>`));
  const dec = f.decoder;
  if (dec || f.image || ["readsb", "dump1090-fa", "dump1090-mutability"].some((n) => f.units?.[n])) {
    rows.push(line("ADS-B decoder", dec ? `<span class="line-val">${dot(f.checked - dec.now > 60 ? "fail" : "ok")} ${num(dec.aircraft)} aircraft, ${num(dec.with_pos)} with a position</span>
        <span class="dim small">${esc(dec.where)}${dec.gain_db != null ? `; gain ${dec.gain_db} dB` : ""}</span>`
      : `<span class="line-val">${dot("off")} No decoder's data on this machine</span>`));
  }
  const units = Object.entries(f.units || {}), boxes = Object.entries(f.containers || {});
  if (units.length || boxes.length) {
    rows.push(line("Services", `<ul class="chips svc">${units.map(([n, st]) => `<li class="${st === "active" ? "ok" : st === "failed" ? "fail" : "off"}">${esc(n)} <b>${esc(st)}</b></li>`).join("")}
      ${boxes.map(([n, st]) => `<li class="${/^Up/.test(st) ? "ok" : "fail"}">${esc(n)} <b>${esc(st.replace(/\s*\(.*\)/, ""))}</b></li>`).join("")}</ul>`));
  }
  const fd = Object.entries(f.feeders || {});
  if (fd.length) rows.push(line("Feeders", fd.map(([n, x]) => `<span class="line-val">${dot(x.connected ? "ok" : "warn")} ${{ flightaware: "FlightAware", flightradar24: "Flightradar24" }[n] || esc(n)}: ${x.connected ? "connected" : "not connected"}</span>`).join("")));
  if (f.units?.["adsb-tunnel"]) rows.push(line("Tunnel", `<span class="line-val">${dot(f.units["adsb-tunnel"] === "active" ? "ok" : "fail")} adsb-tunnel ${esc(f.units["adsb-tunnel"])}</span>`));
  const progs = Object.entries(f.radio || {}).filter(([, v]) => v);
  if (progs.length) rows.push(line("Radio programs", `<span class="line-val">${progs.map(([n]) => esc(n)).join(", ")} installed</span><span class="dim small">The radio isn't run by CloudWall yet.</span>`));
  return rows;
}

/** The commands for what's done at the machine itself (the station only reads). */
export function commandRows(f) {
  const decoderUnit = ["readsb", "dump1090-fa", "dump1090-mutability"].find((n) => f?.units?.[n]);
  return [
    line("Check it", copyable("cloudwall station --check")),
    f?.decoder || decoderUnit || f?.image ? line("Restart the decoder", copyable(decoderUnit ? `sudo systemctl restart ${decoderUnit}` : f.image === "adsb.im" ? "sudo docker restart ultrafeeder" : "sudo systemctl restart readsb")) : null,
    line("Update it", copyable("cd ~/CloudWall && git pull && sudo python3 -m cloudwall upgrade")),
    line("Restart it", copyable("sudo reboot")),
  ].filter(Boolean);
}

/** The facts, then the commands under an Advanced row: as the ADS-B page shows a receiver. */
export function machineGroupRows(f) {
  return [...machineRows(f), advanced(() => "commands to run on this machine", commandRows(f))];
}

/** The address a station joins this wall at: as this board is reached, with its private link if any. */
export const wallAddress = () => `${location.origin}${location.pathname.replace(/\/admin\/?$/, "")}`;

/** The steps that bring a machine onto this wall, with the code the board made. */
export function joinSteps(code) {
  const box = el(`<ol class="steps big station-steps">
    <li><b>On the Pi</b>, update CloudWall and install the station (a new Pi: clone CloudWall into ~/CloudWall first, as on the others):<div data-copy="cd ~/CloudWall && git pull && sudo python3 -m cloudwall install --role station"></div></li>
    <li><b>On the Pi</b>, join it to this wall${code ? "" : " (make a code first)"}:<div data-copy="sudo cloudwall station join ${esc(wallAddress())} ${esc(code || "<code>")}"></div></li>
  </ol>`);
  box.querySelectorAll("[data-copy]").forEach((d) => d.replaceWith(copyable(d.dataset.copy)));
  return box;
}

export { ago };
