// Applies brightness/warmth to the page as a CSS filter on <html>.
// Settings live in chrome.storage.local (see shared.js for the schema).
(() => {
  const SITE_KEY = "site:" + PB.hostKey(location);
  const state = { site: undefined, global: undefined, schedule: undefined };
  let lastKey = null;   // last applied "b/w/night": unchanged results are skipped entirely
  let badgeSig = "";    // what we last asked the badge to show ("" = nothing)
  let timer = null;
  let dead = false;     // set once the extension has been reloaded/updated under us

  let want = "";        // filter string we want on <html> ("" = none)
  let applied = "";     // what the browser serialized after we set it (used to detect tampering)
  let rootObs = null, styleObs = null, watchedRoot = null;
  let fixes = 0, fixWindow = 0;

  const alive = () => {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  };

  function compute() {
    const base = PB.normalizeEntry(state.site) || PB.normalizeEntry(state.global);
    return PB.effective(base, state.schedule, new Date());
  }

  // ---- painting ----

  // At document_start <html> can briefly be missing; wait for it instead of giving up.
  function waitForRoot() {
    if (rootObs) return;
    rootObs = new MutationObserver(() => {
      if (document.documentElement) { rootObs.disconnect(); rootObs = null; paint(); }
    });
    rootObs.observe(document, { childList: true });
  }

  function intact(root) {
    return root.style.getPropertyValue("filter") === applied &&
           root.style.getPropertyPriority("filter") === "important";
  }

  // Some pages rewrite <html style> (SPAs, frameworks). Re-apply if our filter got dropped.
  function watchStyle(root) {
    if (styleObs && watchedRoot === root) return;
    if (styleObs) styleObs.disconnect();
    watchedRoot = root;
    styleObs = new MutationObserver(() => {
      if (!want || !applied || intact(root)) return; // our own writes land here and stop at intact()
      const now = performance.now();
      if (now - fixWindow > 1000) { fixWindow = now; fixes = 0; }
      if (++fixes > 20) return; // something keeps fighting us; back off rather than loop
      root.style.setProperty("filter", want, "important");
    });
    styleObs.observe(root, { attributes: true, attributeFilter: ["style"] });
  }

  function paint() {
    const root = document.documentElement;
    if (!root) { waitForRoot(); return; }
    if (want) {
      root.style.setProperty("filter", want, "important");
      applied = root.style.getPropertyValue("filter");
      watchStyle(root);
    } else if (applied) {
      // Only undo what we set. A page we never touched gets no DOM write at all.
      root.style.removeProperty("filter");
      applied = "";
    }
  }

  // ---- badge ----

  // Asks the background worker to label this tab's toolbar icon. Sends nothing when
  // there's nothing to show and nothing to clear, or when the label hasn't changed
  // (unless forced, for re-sends after bfcache restore / load). Never rejects.
  async function reportBadge(e, force) {
    const text = PB.badgeText(e);
    const sig = text ? text + "|" + e.night : "";
    if (sig === badgeSig && (!force || !sig)) return;
    badgeSig = sig;
    try {
      await chrome.runtime.sendMessage({ type: "badge", text, night: e.night });
    } catch (_) {
      // Worker unavailable, or the extension was reloaded and this script is orphaned.
    }
  }

  // ---- main loop ----

  function shutdown() {
    // The extension was reloaded or updated. Chrome doesn't re-inject into open tabs,
    // so stop timers; the page keeps its last filter until it is reloaded.
    dead = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  function render(force) {
    if (dead) return;
    if (!alive()) { shutdown(); return; }
    const e = compute();
    const key = e.b + "/" + e.w + "/" + e.night;
    if (!force && key === lastKey) return; // nothing effective changed: no DOM write, no message
    lastKey = key;
    want = PB.filterString(e);
    paint();
    reportBadge(e, force);
  }

  // While a schedule is enabled, re-check just after each minute boundary so the
  // night window starts and ends on time (instead of up to a minute late).
  const scheduleOn = () => PB.normalizeSchedule(state.schedule).on;

  function scheduleTick() {
    const delay = 60000 - (Date.now() % 60000) + 50;
    timer = setTimeout(() => {
      timer = null;
      render(false);
      if (!dead && scheduleOn()) scheduleTick();
    }, delay);
  }

  function syncTimer() {
    if (scheduleOn() && timer === null && !dead) scheduleTick();
    else if (!scheduleOn() && timer !== null) { clearTimeout(timer); timer = null; }
  }

  (async () => {
    try {
      const res = await chrome.storage.local.get([SITE_KEY, "global", "schedule"]);
      state.site = res[SITE_KEY];
      state.global = res.global;
      state.schedule = res.schedule;
      render(false);
      syncTimer();
    } catch (_) {
      // Storage unavailable: leave the page untouched rather than guess.
    }
  })();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let hit = false;
    if (SITE_KEY in changes) { state.site = changes[SITE_KEY].newValue; hit = true; }
    if ("global" in changes) { state.global = changes.global.newValue; hit = true; }
    if ("schedule" in changes) { state.schedule = changes.schedule.newValue; hit = true; }
    if (hit) { render(false); syncTimer(); }
  });

  // The popup asks which site key this tab uses. Answering also tells it the script is
  // running here, so it can say "can't adjust this page" on pages where it isn't.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "hostKey") sendResponse({ host: PB.hostKey(location) });
  });

  // Catch up after sleep / background-tab throttling, and after back-forward cache restores.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(false); });
  window.addEventListener("pageshow", (ev) => { if (ev.persisted) render(true); });
  // Belt and braces: re-send the badge once the document is ready, in case the
  // browser reset the tab's badge after our first message.
  document.addEventListener("DOMContentLoaded", () => { if (!dead) reportBadge(compute(), true); }, { once: true });
})();
