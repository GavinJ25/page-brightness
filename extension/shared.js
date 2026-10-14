// Helpers shared by content.js, popup.js and background.js. Pure functions, no I/O.
// Storage schema (chrome.storage.local):
//   "global"        -> {b, w}   brightness 10-200, warmth 0-100   (legacy: a bare number = brightness)
//   "site:<host>"   -> {b, w}   same shape; overrides "global" entirely for that site
//   "schedule"      -> {on, start:"HH:MM", end:"HH:MM", b:30-100, w:0-100}
(() => {
  const B_MIN = 10, B_MAX = 200;

  // Round + clamp a number; anything that isn't a finite number gets the fallback.
  const num = (v, lo, hi, fb) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fb;

  const time = (s, fb) => (typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : fb);
  const minutes = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

  // Stable per-site key. Strips "www.", lowercases, and keeps the port only for
  // localhost / IP addresses (where different ports are usually different apps).
  function hostKey(loc) {
    let h = (loc.hostname || "").toLowerCase();
    if (!h) return "local-file";
    if (h.startsWith("www.") && h.indexOf(".", 4) !== -1) h = h.slice(4);
    const local = h === "localhost" || h.endsWith(".localhost") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");
    if (local && loc.port) h += ":" + loc.port;
    return h;
  }

  // Accepts the legacy number format or {b, w}. Returns null if there's nothing usable.
  function normalizeEntry(v) {
    if (typeof v === "number") return { b: num(v, B_MIN, B_MAX, 100), w: 0 };
    if (v && typeof v === "object") return { b: num(v.b, B_MIN, B_MAX, 100), w: num(v.w, 0, 100, 0) };
    return null;
  }

  function normalizeSchedule(v) {
    const d = { on: false, start: "21:00", end: "07:00", b: 70, w: 30 };
    if (!v || typeof v !== "object") return d;
    return {
      on: v.on === true,
      start: time(v.start, d.start),
      end: time(v.end, d.end),
      b: num(v.b, 30, 100, d.b),
      w: num(v.w, 0, 100, d.w),
    };
  }

  function nightActive(sched, date) {
    const s = normalizeSchedule(sched);
    if (!s.on) return false;
    const now = date.getHours() * 60 + date.getMinutes();
    const a = minutes(s.start), b = minutes(s.end);
    if (a === b) return false;
    return a < b ? now >= a && now < b : now >= a || now < b; // window may wrap midnight
  }

  // Night profile layers on top of the page setting: brightness multiplies, warmth takes the larger.
  function effective(base, sched, date) {
    const e = normalizeEntry(base) || { b: 100, w: 0 };
    const s = normalizeSchedule(sched);
    if (!nightActive(s, date)) return { b: e.b, w: e.w, night: false };
    return {
      b: num((e.b * s.b) / 100, B_MIN, B_MAX, e.b),
      w: Math.max(e.w, s.w),
      night: true,
    };
  }

  function filterString(e) {
    const parts = [];
    if (e.w > 0) parts.push("sepia(" + e.w / 100 + ")");
    if (e.b !== 100) parts.push("brightness(" + e.b / 100 + ")");
    return parts.join(" ");
  }

  function badgeText(e) {
    if (e.b !== 100) return String(e.b);
    return e.w > 0 ? "warm" : "";
  }

  globalThis.PB = Object.freeze({
    hostKey, normalizeEntry, normalizeSchedule, nightActive, effective, filterString, badgeText,
  });
})();
