const $ = (id) => document.getElementById(id);
const slider = $("slider"), valEl = $("val");
const wSlider = $("wslider"), wValEl = $("wval");
const allBox = $("all"), hostEl = $("host"), statusEl = $("status");
const nightOn = $("nightOn"), nightStart = $("nightStart"), nightEnd = $("nightEnd");
const nightB = $("nightB"), nightBVal = $("nightBVal"), nightW = $("nightW"), nightWVal = $("nightWVal");
const siteList = $("siteList"), sitesSummary = $("sitesSummary"), clearAllBtn = $("clearAll");

const DEFAULT = { b: 100, w: 0 };
const isDefault = (e) => e.b === 100 && e.w === 0;

let siteKey = null;
let globalVal = null;                    // stored global entry {b, w}, or null if none
let schedule = PB.normalizeSchedule(null);
let confirmTimer = null;
// Remembers what ticking "Default for all sites" changed, so unticking can undo it:
// { prevSite: this site's own entry before the tick (or null),
//   createdGlobal: the tick created the global setting, edited: global was changed afterwards }
let stash = null;

// Storage writes are fire-and-forget from the UI's point of view: log a failure
// instead of letting it become an unhandled rejection. The op starts synchronously.
async function write(op) {
  try {
    await op();
  } catch (e) {
    console.error("Page Brightness: storage write failed", e);
  }
}

// At most one storage write per `ms` while a slider is dragged (so open tabs follow
// along live without a write storm); flush() writes immediately when the drag ends.
// Arguments given to flush() are passed through to the write.
function throttled(write, ms = 60) {
  let t = null;
  return {
    queue() { if (t === null) t = setTimeout(() => { t = null; write(); }, ms); },
    flush(...args) { if (t !== null) { clearTimeout(t); t = null; write(...args); } },
    cancel() { clearTimeout(t); t = null; },
  };
}

// ---------- brightness / warmth ----------

function show(e) {
  slider.value = e.b;
  valEl.textContent = e.b + "%";
  wSlider.value = e.w;
  wValEl.textContent = e.w + "%";
}

function current() {
  return { b: Number(slider.value), w: Number(wSlider.value) };
}

function writeGlobal(e) {
  if (isDefault(e)) {
    globalVal = null;
    write(() => chrome.storage.local.remove("global"));
  } else {
    globalVal = e;
    write(() => chrome.storage.local.set({ global: e }));
  }
}

function writeSite(e) {
  // A default value only needs storing when it overrides a global setting;
  // otherwise "no key" already means 100% / no warmth.
  if (isDefault(e) && !globalVal) write(() => chrome.storage.local.remove(siteKey));
  else write(() => chrome.storage.local.set({ [siteKey]: e }));
}

function save(e, toGlobal = allBox.checked) {
  show(e);
  if (!siteKey) return;
  if (toGlobal) {
    if (stash) stash.edited = true;
    writeGlobal(e);
  } else {
    writeSite(e);
  }
}

// Sync the controls from storage for the current site.
function applyStored(res) {
  globalVal = PB.normalizeEntry(res.global);
  const site = siteKey ? PB.normalizeEntry(res[siteKey]) : null;
  allBox.checked = !site && !!globalVal;
  stash = null;
  show(site || globalVal || DEFAULT);
}

const pageWrite = throttled((toGlobal) => save(current(), toGlobal));
for (const el of [slider, wSlider]) {
  el.addEventListener("input", () => { show(current()); pageWrite.queue(); });
  el.addEventListener("change", () => pageWrite.flush());
}
// Buttons write immediately; drop any slider write still pending so it can't land afterwards.
$("dim").onclick = () => { pageWrite.cancel(); save({ b: 60, w: Number(wSlider.value) }); };
$("bright").onclick = () => { pageWrite.cancel(); save({ b: 130, w: Number(wSlider.value) }); };
// Reset only affects the active scope (this site, or the default if the box is ticked).
$("reset").onclick = () => { pageWrite.cancel(); save(DEFAULT); };

allBox.addEventListener("change", () => {
  if (!siteKey) return;
  // A pending slider write belongs to the scope we're leaving. The box has already
  // flipped, so say explicitly which scope that was.
  pageWrite.flush(!allBox.checked);
  const c = current();
  if (allBox.checked) {
    // Follow the default: drop this site's own setting (remembered so untick can restore it).
    const prevSite = isDefault(c) && !globalVal ? null : c;
    write(() => chrome.storage.local.remove(siteKey));
    if (!globalVal) {
      writeGlobal(c); // nothing to overwrite, so the current values become the default
      stash = { prevSite, createdGlobal: !isDefault(c), edited: false };
    } else {
      show(globalVal); // never overwrite an existing default
      stash = { prevSite, createdGlobal: false, edited: false };
    }
  } else {
    // Back to this site only. Undo what the tick did, unless the default was edited since.
    const s = stash;
    stash = null;
    if (s && s.createdGlobal && !s.edited) writeGlobal(DEFAULT);
    const restore = s && s.prevSite ? s.prevSite : c;
    show(restore);
    writeSite(restore);
  }
});

// ---------- night schedule ----------

function showSchedule() {
  nightOn.checked = schedule.on;
  nightStart.value = schedule.start;
  nightEnd.value = schedule.end;
  nightB.value = schedule.b;
  nightBVal.textContent = schedule.b + "%";
  nightW.value = schedule.w;
  nightWVal.textContent = schedule.w + "%";
}

function updateStatus() {
  const active = PB.nightActive(schedule, new Date());
  statusEl.classList.toggle("on", active);
  statusEl.textContent = active ? "Night schedule is active, applied on top of these settings." : "";
}

function saveSchedule() {
  schedule = PB.normalizeSchedule({
    on: nightOn.checked,
    start: nightStart.value || schedule.start, // time inputs are "" while half-edited
    end: nightEnd.value || schedule.end,
    b: Number(nightB.value),
    w: Number(nightW.value),
  });
  nightBVal.textContent = schedule.b + "%";
  nightWVal.textContent = schedule.w + "%";
  write(() => chrome.storage.local.set({ schedule }));
  updateStatus();
}

const nightWrite = throttled(saveSchedule);
for (const el of [nightB, nightW]) {
  el.addEventListener("input", () => {
    nightBVal.textContent = nightB.value + "%";
    nightWVal.textContent = nightW.value + "%";
    nightWrite.queue();
  });
  el.addEventListener("change", () => nightWrite.flush());
}
for (const el of [nightOn, nightStart, nightEnd]) {
  el.addEventListener("change", () => { nightWrite.cancel(); saveSchedule(); }); // saves slider values too
}

// The popup can close mid-drag; don't lose the last movement.
window.addEventListener("pagehide", () => { pageWrite.flush(); nightWrite.flush(); });

// ---------- saved sites ----------

function describe(e) {
  return e.b + "%" + (e.w > 0 ? " · warm " + e.w + "%" : "");
}

function renderSites(all) {
  const entries = Object.keys(all)
    .filter((k) => k.startsWith("site:"))
    .sort()
    .map((k) => [k, PB.normalizeEntry(all[k])])
    .filter(([, e]) => e);

  sitesSummary.textContent = "Saved sites (" + entries.length + ")";
  siteList.replaceChildren();
  clearAllBtn.hidden = entries.length === 0;

  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No saved sites yet.";
    siteList.append(li);
    return;
  }
  for (const [key, e] of entries) {
    const host = key.slice(5);
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = host;
    const info = document.createElement("span");
    info.className = "info";
    info.textContent = describe(e);
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.title = "Remove " + host;
    x.setAttribute("aria-label", "Remove " + host);
    x.addEventListener("click", () => removeSites([key]));
    li.append(name, info, x);
    siteList.append(li);
  }
}

async function removeSites(keys) {
  pageWrite.cancel();
  try {
    await chrome.storage.local.remove(keys);
    if (siteKey && keys.includes(siteKey)) {
      applyStored(await chrome.storage.local.get([siteKey, "global"]));
    }
  } catch (e) {
    console.error("Page Brightness: could not remove saved sites", e);
  }
}

function disarm() {
  clearTimeout(confirmTimer);
  delete clearAllBtn.dataset.armed;
  clearAllBtn.textContent = "Clear all site settings";
}

clearAllBtn.addEventListener("click", async () => {
  if (!clearAllBtn.dataset.armed) { // first click arms, second click (within 3s) confirms
    clearAllBtn.dataset.armed = "1";
    clearAllBtn.textContent = "Click again to confirm";
    confirmTimer = setTimeout(disarm, 3000);
    return;
  }
  disarm();
  try {
    const all = await chrome.storage.local.get(null);
    await removeSites(Object.keys(all).filter((k) => k.startsWith("site:")));
  } catch (e) {
    console.error("Page Brightness: could not clear saved sites", e);
  }
});

// Keep the list live (deletes here, or changes made while the popup is open).
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && Object.keys(changes).some((k) => k.startsWith("site:"))) {
    try {
      renderSites(await chrome.storage.local.get(null));
    } catch (e) {
      console.error("Page Brightness: could not refresh saved sites", e);
    }
  }
});

// ---------- init ----------

function disablePageControls() {
  // Schedule and saved sites stay usable; only the per-page controls are disabled.
  slider.disabled = wSlider.disabled = allBox.disabled = true;
  document.querySelectorAll(".btns button").forEach((b) => (b.disabled = true));
}

// Ask the page's content script which site key it uses. This needs no extra permission,
// and a reply also proves the script is running there (it isn't on chrome:// pages, the
// Web Store, the PDF viewer, file:// without access, or tabs opened before an update).
async function currentHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const reply = await chrome.tabs.sendMessage(tab.id, { type: "hostKey" }, { frameId: 0 });
    return reply && typeof reply.host === "string" ? reply.host : null;
  } catch (_) {
    return null;
  }
}

async function init() {
  let all;
  try {
    all = await chrome.storage.local.get(null);
  } catch (e) {
    console.error("Page Brightness: could not read settings", e);
    hostEl.textContent = "Couldn't read saved settings.";
    disablePageControls();
    return;
  }
  schedule = PB.normalizeSchedule(all.schedule);
  showSchedule();
  updateStatus();
  renderSites(all);

  const host = await currentHost();
  if (!host) {
    hostEl.textContent = "This page can't be adjusted. If it's a regular website, reload the tab.";
    disablePageControls();
    return;
  }
  hostEl.textContent = host;
  siteKey = "site:" + host;
  applyStored(all);
}

init();
