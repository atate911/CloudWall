// The board's icons: one line weight, drawn for what each part is (an antenna for the receiver, a
// fuel gauge's arc for the paid allowance), not taken from a general set.
const P = {
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v8.5h11V10"/><path d="M10.5 18.5v-4.5h3v4.5"/>',
  receiver: '<path d="M12 21V10"/><path d="m8.5 21 3.5-11 3.5 11"/><path d="M9.6 17.5h4.8"/><circle cx="12" cy="8" r="1.6"/><path d="M8.6 4.6a4.8 4.8 0 0 0 0 6.8M15.4 4.6a4.8 4.8 0 0 1 0 6.8"/><path d="M6.2 2.4a8 8 0 0 0 0 11.2M17.8 2.4a8 8 0 0 1 0 11.2"/>',
  positions: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/><circle cx="15.6" cy="15.2" r="1.1" class="fill"/><circle cx="8" cy="9" r="1.1" class="fill"/>',
  places: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  routes: '<circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><path d="M6.4 15.6C8.5 8 15.5 8 17.6 15.6" stroke-dasharray="2 2.4"/><path d="m12 8.6 1.6.9-1.6.9"/>',
  look: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/><path d="M7 13l3-3 2.5 2 4-4.5"/>',
  access: '<circle cx="8" cy="14" r="4"/><path d="m11 11 8.5-8.5M16 6l2.5 2.5M14 8l2 2"/>',
  safekeeping: '<path d="M4 7.5h16v3H4z"/><path d="M5.5 10.5V19h13v-8.5"/><path d="M10 14h4"/>',
  problems: '<path d="M3 12h4l2.2-5.5 4 11 2.4-5.5H21"/>',
  server: '<rect x="4" y="4" width="16" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="6.5" rx="1.5"/><path d="M7.5 7.2h.01M7.5 16.7h.01"/><path d="M11 7.2h5.5M11 16.7h5.5"/>',
  sky: '<path d="M6.5 17.5a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.4 1.6 3.3 3.3 0 0 1-.3 6.4z"/>',
  feeds: '<path d="M4 6h7c3 0 3 6 6 6h3M4 18h7c3 0 3-6 6-6"/><path d="m17.5 9.5 2.5 2.5-2.5 2.5"/>',
  screens: '<rect x="2.5" y="5" width="13" height="9" rx="1.5"/><path d="M6 18h6M9 14v4"/><rect x="17.5" y="8" width="4" height="9" rx="1"/>',
  logbook: '<path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v15H7.5A1.5 1.5 0 0 1 6 18.5z"/><path d="M6 18.5A1.5 1.5 0 0 1 7.5 17h11"/><path d="M9.5 7.5h5.5M9.5 10.5h5.5"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  tunnel: '<path d="M3 19V12a9 9 0 0 1 18 0v7"/><path d="M7.5 19v-6a4.5 4.5 0 0 1 9 0v6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  open: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M17.5 14v4.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V8.5A1.5 1.5 0 0 1 6 7h4.5"/>',
  download: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 19.5h14"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="m11 11 8.5-8.5M16 6l2.5 2.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  restart: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  pin: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/>',
  military: '<path d="M12 3 14 9h6l-5 3.8 2 6.2-5-3.9L7 19l2-6.2L4 9h6z"/>',
  tfr: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  contrail: '<path d="M4 18 18 6"/><path d="M4 14l8-7M8 19l7-6" stroke-dasharray="1.5 2.5"/><path d="m17 4 3 1-1 3"/>',
  logo: '<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M8 14.5 12 9l4 5.5"/>',
};

export function icon(name, cls = "") {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.info}</svg>`;
}
