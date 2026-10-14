// Sets per-tab toolbar badges on request from the content script, and migrates old keys.
// Stateless on purpose: Chrome stops this worker after ~30 s idle, so nothing lives in variables.
importScripts("shared.js");

const NORMAL = "#2f6fed";
const NIGHT = "#5b45c9";

async function setBadge(tabId, text, night) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color: night ? NIGHT : NORMAL });
  } catch (_) {
    // The tab was closed before we got to it. Nothing to do.
  }
}

// Fire-and-forget message from the content script; no response is sent.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "badge" || !sender.tab || sender.frameId !== 0) return;
  setBadge(sender.tab.id, String(msg.text || "").slice(0, 4), !!msg.night);
});

// v1.0.x stored "site:www.example.com"; v1.1+ uses the normalized "site:example.com".
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "update") return;
  try {
    const all = await chrome.storage.local.get(null);
    const move = {};
    const drop = [];
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith("site:")) continue;
      const host = k.slice(5);
      const fixed = PB.hostKey({ hostname: host, port: "" });
      if (fixed === host) continue;
      drop.push(k);
      if (!(("site:" + fixed) in all) && !(("site:" + fixed) in move)) move["site:" + fixed] = v;
    }
    if (Object.keys(move).length) await chrome.storage.local.set(move);
    if (drop.length) await chrome.storage.local.remove(drop);
  } catch (e) {
    console.error("Page Brightness: key migration failed", e);
  }
});
