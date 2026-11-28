// What changes slowly (the weather, the logbook, the day's heatmap), fetched once for the whole
// page however many parts of it show it.
import { api } from "./util.js";

const kept = {};      // path -> { data, tried, asking }

export const latest = (path) => (kept[path] ? kept[path].data : null);

// Fetch again unless tried within maxAge ms (0: now). Resolves to the answer, or the one before if
// the server isn't answering. Callers at the same moment share one request.
export function refresh(path, maxAge = 60000) {
  const k = kept[path] || (kept[path] = { data: null, tried: 0, asking: null });
  if (k.asking) return k.asking;
  if (Date.now() - k.tried < maxAge) return Promise.resolve(k.data);
  k.tried = Date.now();
  k.asking = api(path).then((r) => r.json()).then((d) => { k.data = d; return d; }, () => k.data)
    .finally(() => { k.asking = null; });
  return k.asking;
}
