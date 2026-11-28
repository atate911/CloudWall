// Run by the tests workflow: an undefined name (a forgotten import) or an unused one fails it.
// Not needed to run or work on CloudWall.
const browser = `document window location fetch navigator performance requestAnimationFrame cancelAnimationFrame
  setTimeout clearTimeout setInterval clearInterval console URL URLSearchParams localStorage sessionStorage Image
  HTMLImageElement HTMLElement Element Event EventTarget CustomEvent IntersectionObserver ResizeObserver MutationObserver
  AbortSignal AbortController getComputedStyle matchMedia CSS confirm alert prompt history screen innerWidth innerHeight
  devicePixelRatio scrollTo scrollBy addEventListener removeEventListener DOMParser Path2D Blob Option structuredClone
  DeviceOrientationEvent crypto Intl Node SVGElement globalThis process XMLSerializer scrollY scrollX Response DOMRect
  HTMLCanvasElement HTMLInputElement requestIdleCallback open deck maplibregl pmtiles`.split(/\s+/);

export default [{
  files: ["cloudwall/web/js/**/*.js", "coverage3d/coverage3d/web/*.js"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: Object.fromEntries(browser.map((n) => [n, "readonly"])) },
  rules: { "no-undef": "error", "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
}];
