// The phone's compass, for the Sky view: which way the phone is facing, so the dome can turn with
// it and the aircraft on screen sit where they are in the sky in front of you.
//
// Held flat (screen up), the phone faces the way its top points; held up in front of you, the way
// its back points (where you are looking). iPhones give the heading directly once the page has
// asked (a tap is needed: iOS asks the person); Android gives the phone's orientation against the
// earth, from which the heading is worked out. Either way only over HTTPS: browsers keep the
// compass from plain-HTTP pages, as they do the location.
//
// The heading is magnetic: a few degrees (up to 15 or 20 in parts of North America) from true north.

const RAD = Math.PI / 180;
export const compass = { on: false, heading: null, at: 0, failed: "" };
let listening = false, sx = 0, sy = 0;

const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === "number" ? screen.orientation.angle
  : typeof window.orientation === "number" ? window.orientation : 0);

// The heading from the phone's orientation against the earth (alpha, beta, gamma in degrees).
export function headingFrom(alpha, beta, gamma) {
  if (Math.abs(beta) < 45 && Math.abs(gamma) < 45) {
    // lying flat-ish: the way the top of the screen points, as the screen is turned
    return (360 - alpha + screenAngle() + 720) % 360;
  }
  // held up: the way the back of the phone points (the W3C specification's compass heading)
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;
  const rA = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const rB = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  return ((Math.atan2(rA, rB) / RAD) + 360) % 360;
}

// Each reading eased into the last, as a direction (so 359° and 1° average to 0°, not 180°):
// a compass needle's steadiness, without lagging a turn by more than a moment.
function take(h) {
  const k = compass.heading == null ? 1 : 0.25;
  sx = sx * (1 - k) + Math.sin(h * RAD) * k;
  sy = sy * (1 - k) + Math.cos(h * RAD) * k;
  compass.heading = ((Math.atan2(sx, sy) / RAD) + 360) % 360;
  compass.at = Date.now();
}
let absolute = false;
function onAbsolute(e) {
  if (!compass.on || e.alpha == null) return;
  absolute = true;
  take(headingFrom(e.alpha, e.beta || 0, e.gamma || 0));
}
function onRelative(e) {
  if (!compass.on) return;
  if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0) take((e.webkitCompassHeading + screenAngle()) % 360);   // iOS
  else if (!absolute && e.absolute && e.alpha != null) take(headingFrom(e.alpha, e.beta || 0, e.gamma || 0));   // a browser with no "absolute" event
}

// Turn the compass on: from a tap, as iOS asks the person then. Resolves false (with the reason in
// compass.failed) where there is none to be had.
export async function startCompass() {
  compass.failed = "";
  if (!window.isSecureContext) { compass.failed = "The compass needs CloudWall opened over HTTPS (the private link)"; return false; }
  if (typeof DeviceOrientationEvent === "undefined") { compass.failed = "This browser has no compass"; return false; }
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      if ((await DeviceOrientationEvent.requestPermission()) !== "granted") { compass.failed = "Compass not allowed"; return false; }
    } catch (e) { compass.failed = "Compass not allowed"; return false; }
  }
  if (!listening) {
    listening = true;
    window.addEventListener("deviceorientationabsolute", onAbsolute);
    window.addEventListener("deviceorientation", onRelative);
  }
  compass.on = true; compass.heading = null; compass.at = Date.now();
  return true;
}

export function stopCompass() { compass.on = false; compass.heading = null; }

// The heading to draw by: null while off, or while nothing has been heard from the compass lately.
export const facing = () => (compass.on && compass.heading != null && Date.now() - compass.at < 5000 ? compass.heading : null);
