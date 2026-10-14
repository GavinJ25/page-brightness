// Test suite: runs the extension's real scripts against a mocked chrome API in jsdom.
// Usage: npm install && npm test
const fs = require("fs"), vm = require("vm"), path = require("path");
const { JSDOM } = require("jsdom");
const D = path.join(__dirname, "..", "extension") + path.sep;
const read = (f) => fs.readFileSync(D + f, "utf8");
let fails = 0, passes = 0;
const eq = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  ok ? passes++ : fails++;
  if (!ok) console.log("FAIL " + n + "  got=" + JSON.stringify(g) + " want=" + JSON.stringify(w));
};
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const quiet = (fn) => { const e = console.error; console.error = () => {}; return fn().finally(() => { console.error = e; }); };

function mk(initial, sent = []) {
  const store = { ...initial }, ls = [], stats = { sets: 0 }, msgL = [];
  const fire = (c) => ls.forEach((f) => f(c, "local"));
  const pick = (k) => k == null ? { ...store } : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]]));
  const local = {
    get: (k, cb) => { const r = pick(k); return cb ? (cb(r), undefined) : Promise.resolve(r); },
    set: (o) => { stats.sets++; const c = {}; for (const [k, v] of Object.entries(o)) { c[k] = { oldValue: store[k], newValue: v }; store[k] = v; } fire(c); return Promise.resolve(); },
    remove: (k) => { const c = {}; for (const x of [].concat(k)) if (x in store) { c[x] = { oldValue: store[x] }; delete store[x]; } if (Object.keys(c).length) fire(c); return Promise.resolve(); },
  };
  return { store, stats, msgL, chrome: {
    storage: { local, onChanged: { addListener: (f) => ls.push(f) } },
    runtime: { id: "ext", sendMessage: async (m) => { sent.push(m); }, onMessage: { addListener: (f) => msgL.push(f) } },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async (id, msg, opts) => { if (mk.host == null) throw new Error("Could not establish connection. Receiving end does not exist."); mk.lastMsg = [id, msg, opts]; return { host: mk.host }; } },
  } };
}

async function content(url, initial, opts = {}) {
  const sent = [], m = mk(initial, sent);
  const w = new JSDOM("<!doctype html><html><body></body></html>", { url, runScripts: "outside-only" }).window;
  const root = w.document.documentElement, calls = [];
  for (const n of ["setProperty", "removeProperty"]) { const o = root.style[n].bind(root.style); root.style[n] = (...a) => { calls.push([n === "removeProperty" ? "rm" : n, ...a]); return o(...a); }; }
  const clock = { now: opts.now ?? new Date(2026, 9, 7, 12, 0, 0).getTime() };
  class FD extends w.Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } }
  w.Date = FD;
  const timers = { set: [], cleared: 0, cbs: [] };
  w.setTimeout = (f, d) => { timers.set.push(d); timers.cbs.push(f); return timers.cbs.length; };
  w.clearTimeout = () => { timers.cleared++; };
  w.chrome = m.chrome;
  w.eval(read("shared.js")); w.eval(read("content.js")); await wait(20);
  return { w, m, sent, calls, root, timers, clock };
}

async function popup(host, initial) {
  mk.host = host; const m = mk(initial);
  const w = new JSDOM(read("popup.html").replace(/<script src[^>]*><\/script>/g, ""), { url: "chrome-extension://x/p.html", runScripts: "outside-only" }).window;
  w.chrome = m.chrome; w.eval(read("shared.js"));
  w.eval(read("popup.js").replace(/^const /gm, "var ").replace(/^let /gm, "var ")); await wait(30);
  const $ = (id) => w.document.getElementById(id), fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true }));
  return { w, m, $, fire,
    drag: async (el, v) => { el.value = v; fire(el, "input"); fire(el, "change"); await wait(5); },
    input: async (el, v) => { el.value = v; fire(el, "input"); await wait(5); },
    tick: async (on) => { $("all").checked = on; fire($("all"), "change"); await wait(10); },
    click: async (el) => { el.click(); await wait(10); } };
}

(async () => {
  // ============ lint: manifest, code style, popup markup ============
  const man = JSON.parse(read("manifest.json"));
  eq("lint: manifest_version 3", man.manifest_version, 3);
  eq("lint: no background.scripts", Object.keys(man.background), ["service_worker"]);
  eq("lint: permissions minimal", man.permissions, ["storage"]);
  eq("lint: no host_permissions", man.host_permissions, undefined);
  eq("lint: action key present", typeof man.action, "object");
  eq("lint: description <= 132", man.description.length <= 132, true);
  const png = (f) => { const b = fs.readFileSync(D + f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  eq("lint: icons exist at declared size", Object.entries({ ...man.icons, ...man.action.default_icon }).every(([s, f]) => { const [w, h] = png(f); return w == +s && h == +s; }), true);
  eq("lint: package.json version matches manifest", JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version, man.version);
  for (const f of ["content.js", "background.js", "popup.js", "shared.js"]) {
    const src = read(f).replace(/\/\/.*$/gm, "");
    eq(`lint: ${f} no .then/.catch chains`, /\.(then|catch)\(|\?\.catch/.test(src), false);
    eq(`lint: ${f} no callback-style chrome.* get`, /chrome\.[a-z.]+\.get\([^)]*,\s*\(?\w*\)?\s*=>/.test(src), false);
    eq(`lint: ${f} no eval`, /\beval\(|new Function\(/.test(src), false);
  }
  eq("lint: background has no mutable globals", /^(let|var) /m.test(read("background.js")), false);
  const html = read("popup.html");
  eq("lint: no inline scripts/handlers/style attrs", /<script(?![^>]*src)|\son\w+=|style="/.test(html), false);
  eq("lint: dark overrides only on :root tokens", (html.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root/g) || []).length, 1);
  {
    const d = new JSDOM(html).window.document;
    eq("a11y: html lang", d.documentElement.lang, "en");
    eq("a11y: title", d.title, "Page Brightness");
    eq("a11y: color-scheme meta", d.querySelector('meta[name="color-scheme"]').content, "light dark");
    eq("a11y: main landmark", d.querySelector("main h1") !== null && d.querySelector("main #slider") !== null, true);
    eq("a11y: every input has an explicit label", [...d.querySelectorAll("input")].every((i) => d.querySelector(`label[for="${i.id}"]`)), true);
    eq("a11y: describedby targets exist", [...d.querySelectorAll("[aria-describedby]")].every((e) => d.getElementById(e.getAttribute("aria-describedby"))), true);
    eq("a11y: status is a live region", d.getElementById("status").getAttribute("role"), "status");
  }

  // ============ shared.js ============
  {
    const w = new JSDOM("", { runScripts: "outside-only" }).window; w.eval(read("shared.js")); const PB = w.PB;
    const hk = (u) => PB.hostKey(new URL(u));
    eq("shared: host keys", [hk("https://www.example.com/"), hk("https://www.com/"), hk("http://localhost:3000/"), hk("http://[::1]:5173/"), hk("https://example.com:8443/"), hk("file:///tmp/a.html")], ["example.com", "www.com", "localhost:3000", "[::1]:5173", "example.com", "local-file"]);
    eq("shared: legacy number / clamp", [PB.normalizeEntry(60), PB.normalizeEntry({ b: 999, w: 500 })], [{ b: 60, w: 0 }, { b: 200, w: 100 }]);
    const S = { on: true, start: "21:00", end: "07:00", b: 70, w: 30 }, at = (h, m) => new Date(2026, 9, 7, h, m);
    eq("shared: night wrap", [PB.nightActive(S, at(23, 0)), PB.nightActive(S, at(3, 0)), PB.nightActive(S, at(7, 0)), PB.nightActive(S, at(12, 0))], [true, true, false, false]);
    eq("shared: layering", PB.effective({ b: 80, w: 10 }, S, at(23, 0)), { b: 56, w: 30, night: true });
    eq("shared: filter string / badge", [PB.filterString({ b: 60, w: 20 }), PB.filterString({ b: 100, w: 0 }), PB.badgeText({ b: 100, w: 5 })], ["sepia(0.2) brightness(0.6)", "", "warm"]);
  }

  // ============ content.js ============
  let r = await content("https://plain.com/", {});
  eq("content: untouched page => zero style calls, zero messages", [r.calls, r.sent.length], [[], 0]);
  r = await content("https://www.example.com/", { "site:example.com": { b: 60, w: 20 } });
  eq("content: normalized key + filter", r.calls.at(-1), ["setProperty", "filter", "sepia(0.2) brightness(0.6)", "important"]);
  eq("content: badge message", r.sent.at(-1), { type: "badge", text: "60", night: false });
  r.root.removeAttribute("style"); await wait(10);
  eq("content: wiped style repaired", r.root.style.getPropertyValue("filter"), "sepia(0.2) brightness(0.6)");
  await r.m.chrome.storage.local.remove("site:example.com");
  eq("content: removal clears filter + badge", [r.calls.at(-1), r.sent.at(-1).text], [["rm", "filter"], ""]);
  r = await content("https://s.com/", { global: { b: 60, w: 0 }, "site:s.com": { b: 100, w: 0 } });
  eq("content: site 100 overrides global dim", r.root.style.getPropertyValue("filter"), "");
  r = await content("https://a.com/", { global: 80 });
  eq("content: legacy numeric global", r.root.style.getPropertyValue("filter"), "brightness(0.8)");
  {
    const n0 = r.calls.length, s0 = r.sent.length;
    await r.m.chrome.storage.local.set({ global: 80 });
    eq("content: identical rewrite => nothing", [r.calls.length - n0, r.sent.length - s0], [0, 0]);
    r.w.dispatchEvent(Object.assign(new r.w.Event("pageshow"), { persisted: true }));
    eq("content: bfcache restore resends badge", r.sent.length - s0, 1);
  }
  r = await content("https://plain.com/", {});
  r.root.style.setProperty("filter", "blur(1px)");
  await r.m.chrome.storage.local.set({ "site:other.com": 1 });
  eq("content: page's own html filter left alone", r.root.style.getPropertyValue("filter"), "blur(1px)");
  r = await content("https://www.example.com/", {});
  let reply; r.m.msgL.forEach((f) => f({ type: "hostKey" }, {}, (x) => (reply = x)));
  eq("content: answers hostKey", reply, { host: "example.com" });
  reply = undefined; r.m.msgL.forEach((f) => f({ type: "other" }, {}, (x) => (reply = x)));
  eq("content: ignores other messages", reply, undefined);
  {
    const m = mk({}); m.chrome.storage.local.get = async () => { throw new Error("boom"); };
    const w = new JSDOM("<html></html>", { url: "https://a.com/", runScripts: "outside-only" }).window; w.chrome = m.chrome;
    let threw = false; try { w.eval(read("shared.js")); w.eval(read("content.js")); await wait(15); } catch (_) { threw = true; }
    eq("content: failing storage.get => no crash, no filter", [threw, w.document.documentElement.style.getPropertyValue("filter")], [false, ""]);
  }
  r = await content("https://a.com/", { global: { b: 60, w: 0 } });
  r.m.chrome.runtime.sendMessage = async () => { throw new Error("Extension context invalidated."); };
  await r.m.chrome.storage.local.set({ global: { b: 50, w: 0 } }); await wait(5);
  eq("content: rejecting sendMessage swallowed", r.root.style.getPropertyValue("filter"), "brightness(0.5)");
  {
    const m = mk({ global: { b: 60, w: 0 } });
    const w = new JSDOM("<!doctype html><html></html>", { url: "https://a.com/", runScripts: "outside-only" }).window;
    const realRoot = w.document.documentElement;
    Object.defineProperty(w.document, "documentElement", { configurable: true, get: () => null });
    w.chrome = m.chrome; w.eval(read("shared.js")); w.eval(read("content.js")); await wait(20);
    eq("content: no <html> yet => no crash, nothing applied", realRoot.style.getPropertyValue("filter"), "");
    Object.defineProperty(w.document, "documentElement", { configurable: true, get: () => realRoot });
    w.document.appendChild(w.document.createComment("x")); await wait(15);
    eq("content: applied once <html> appears", realRoot.style.getPropertyValue("filter"), "brightness(0.6)");
  }
  const S2 = { on: true, start: "21:00", end: "07:00", b: 70, w: 30 };
  r = await content("https://a.com/", { schedule: S2 }, { now: new Date(2026, 9, 7, 20, 59, 30).getTime() });
  eq("content: tick aligned to minute boundary", [r.timers.set.length, r.timers.set[0], r.calls], [1, 30050, []]);
  r.clock.now = new Date(2026, 9, 7, 21, 0, 0, 50).getTime(); r.timers.cbs[0]();
  eq("content: switches to night at 21:00", [r.calls.at(-1), r.sent.at(-1).night], [["setProperty", "filter", "sepia(0.3) brightness(0.7)", "important"], true]);
  await r.m.chrome.storage.local.set({ schedule: { ...S2, on: false } });
  eq("content: schedule off cancels timer", r.timers.cleared >= 1, true);
  r = await content("https://a.com/", { schedule: S2 }, { now: new Date(2026, 9, 7, 23, 0, 0).getTime() });
  r.clock.now = new Date(2026, 9, 8, 7, 0, 0, 50).getTime(); r.timers.cbs[0]();
  eq("content: leaves night at 07:00", r.calls.at(-1), ["rm", "filter"]);
  r = await content("https://a.com/", { schedule: S2 }); delete r.m.chrome.runtime.id;
  r.w.dispatchEvent(Object.assign(new r.w.Event("pageshow"), { persisted: true })); await wait(5);
  eq("content: orphaned script cancels timer", r.timers.cleared >= 1, true);

  // ============ background.js ============
  {
    const badge = [], store = { "site:www.example.com": { b: 60, w: 0 }, "site:example.com": { b: 90, w: 0 }, "site:www.foo.org": 70, "site:bar.net": 50, global: 80 };
    let onMsg, onInst; const failTab = { n: null };
    const chrome = { action: { setBadgeText: async (a) => { if (a.tabId === failTab.n) throw new Error("No tab with id"); badge.push(["t", a]); }, setBadgeBackgroundColor: async (a) => { badge.push(["c", a]); } },
      runtime: { onMessage: { addListener: (f) => (onMsg = f) }, onInstalled: { addListener: (f) => (onInst = f) } },
      storage: { local: { get: async () => ({ ...store }), set: async (o) => Object.assign(store, o), remove: async (k) => [].concat(k).forEach((x) => delete store[x]) } } };
    const ctx = { chrome, console: { error() {} }, importScripts: (f) => vm.runInContext(read(f), ctx) }; ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(read("background.js"), ctx);
    onMsg({ type: "badge", text: "60", night: true }, { tab: { id: 7 }, frameId: 0 });
    onMsg({ type: "badge", text: "60" }, { tab: { id: 8 }, frameId: 2 }); onMsg({ type: "badge", text: "60" }, {}); onMsg({ type: "x" }, { tab: { id: 9 }, frameId: 0 });
    await wait(5);
    eq("bg: badge set once, night colour, others ignored", badge, [["t", { tabId: 7, text: "60" }], ["c", { tabId: 7, color: "#5b45c9" }]]);
    failTab.n = 11; let threw = false; try { onMsg({ type: "badge", text: "5" }, { tab: { id: 11 }, frameId: 0 }); await wait(5); } catch (_) { threw = true; }
    eq("bg: closed-tab failure swallowed", threw, false);
    onMsg({ type: "badge", text: "toolongtext" }, { tab: { id: 12 }, frameId: 0 }); await wait(5);
    eq("bg: text capped at 4 chars", badge.at(-2)[1].text, "tool");
    await onInst({ reason: "update" });
    eq("bg: www key migration", store, { "site:example.com": { b: 90, w: 0 }, "site:bar.net": 50, global: 80, "site:foo.org": 70 });
    ctx.chrome.storage.local.get = async () => { throw new Error("x"); };
    let t2 = false; try { await onInst({ reason: "update" }); } catch (_) { t2 = true; }
    eq("bg: migration failure swallowed", t2, false);
  }

  // ============ popup ============
  let p = await popup("example.com", { global: { b: 60, w: 0 } });
  eq("popup: host from content script", p.$("host").textContent, "example.com");
  eq("popup: asks top frame only", mk.lastMsg, [1, { type: "hostKey" }, { frameId: 0 }]);
  await p.tick(false); await p.drag(p.$("slider"), 100);
  eq("popup: site 100 stored over global dim", [p.m.store["site:example.com"], p.m.store.global], [{ b: 100, w: 0 }, { b: 60, w: 0 }]);
  await p.drag(p.$("wslider"), 25);
  eq("popup: warmth saved", p.m.store["site:example.com"], { b: 100, w: 25 });
  await p.click(p.$("reset"));
  eq("popup: reset keeps global", [p.m.store["site:example.com"], p.m.store.global], [{ b: 100, w: 0 }, { b: 60, w: 0 }]);
  await p.tick(true);
  eq("popup: tick never overwrites existing global", [p.m.store.global, "site:example.com" in p.m.store, p.$("slider").value], [{ b: 60, w: 0 }, false, "60"]);
  p = await popup("a.com", { "site:a.com": { b: 80, w: 0 } }); await p.tick(true);
  eq("popup: tick promotes value to default", [p.m.store.global, "site:a.com" in p.m.store], [{ b: 80, w: 0 }, false]);
  await p.tick(false);
  eq("popup: untick in same session restores", [p.m.store.global, p.m.store["site:a.com"]], [undefined, { b: 80, w: 0 }]);
  p = await popup("a.com", { "site:a.com": { b: 80, w: 0 } }); await p.tick(true); await p.drag(p.$("slider"), 50); await p.tick(false);
  eq("popup: untick after editing default keeps it", [p.m.store.global, p.m.store["site:a.com"]], [{ b: 50, w: 0 }, { b: 80, w: 0 }]);
  p = await popup("a.com", {}); const s1 = p.m.stats.sets;
  for (let v = 99; v >= 60; v--) await p.input(p.$("slider"), v);
  eq("popup: slider writes throttled", p.m.stats.sets - s1 >= 1 && p.m.stats.sets - s1 <= 6, true);
  p.fire(p.$("slider"), "change"); await wait(5);
  eq("popup: change flushes final value", p.m.store["site:a.com"], { b: 60, w: 0 });
  p = await popup("a.com", { global: { b: 60, w: 0 } }); await p.tick(false); await p.input(p.$("slider"), 40); await p.tick(true);
  eq("popup: pending write keeps its scope", [p.m.store.global, "site:a.com" in p.m.store], [{ b: 60, w: 0 }, false]);
  p = await popup("a.com", { "site:a.com": { b: 70, w: 0 }, "site:b.com": 90 });
  eq("popup: saved sites count (legacy number listed)", p.$("sitesSummary").textContent, "Saved sites (2)");
  await p.click(p.$("siteList").querySelectorAll("button.x")[0]);
  eq("popup: deleting current site resets slider", [p.$("slider").value, Object.keys(p.m.store)], ["100", ["site:b.com"]]);
  await p.click(p.$("clearAll"));
  eq("popup: clear all needs a second click", Object.keys(p.m.store), ["site:b.com"]);
  await p.click(p.$("clearAll"));
  eq("popup: clear all", Object.keys(p.m.store), []);
  p = await popup("a.com", {}); p.$("nightOn").checked = true; p.fire(p.$("nightOn"), "change");
  await p.input(p.$("nightB"), 50); p.fire(p.$("nightB"), "change"); await wait(5);
  eq("popup: schedule saved", p.m.store.schedule, { on: true, start: "21:00", end: "07:00", b: 50, w: 30 });
  p = await popup(null, { "site:z.com": 80 });
  eq("popup: no content script => message + disabled controls", [p.$("host").textContent.startsWith("This page can't be adjusted"), p.$("slider").disabled, p.$("wslider").disabled, p.$("all").disabled, p.$("dim").disabled], [true, true, true, true, true]);
  eq("popup: saved sites still listed there", p.$("sitesSummary").textContent, "Saved sites (1)");
  await quiet(async () => {
    const m = mk({}); m.chrome.storage.local.get = async () => { throw new Error("boom"); }; mk.host = "a.com";
    const w = new JSDOM(read("popup.html").replace(/<script src[^>]*><\/script>/g, ""), { url: "chrome-extension://x/p.html", runScripts: "outside-only" }).window;
    w.chrome = m.chrome; w.eval(read("shared.js")); let threw = false;
    try { w.eval(read("popup.js").replace(/^const /gm, "var ").replace(/^let /gm, "var ")); await wait(30); } catch (_) { threw = true; }
    eq("popup: failing storage on open => message, controls disabled", [threw, w.document.getElementById("host").textContent, w.document.getElementById("slider").disabled], [false, "Couldn't read saved settings.", true]);
  });
  await quiet(async () => {
    p = await popup("a.com", {}); p.m.chrome.storage.local.set = async () => { throw new Error("QUOTA_BYTES"); };
    let unhandled = false; const h = () => { unhandled = true; }; process.once("unhandledRejection", h);
    await p.drag(p.$("slider"), 70); await wait(20); process.off("unhandledRejection", h);
    eq("popup: failing write contained", unhandled, false);
  });

  console.log(fails ? `${fails} FAILED, ${passes} passed` : `all ${passes} passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
