"""Real-browser regression test: loads the unpacked extension into Chromium and checks, by
sampling screenshot pixels, that a brightness setting reaches every kind of element, including
the "top layer" ones (popovers, modal dialogs, fullscreen) that a filter on <html> alone misses,
and to pages that set no background on <html> or <body> (whose white "canvas" a filter on <html>
doesn't reach).

Optional; the main suite is `npm test`. Needs Python, Playwright and a display
(on Linux without one: `xvfb-run -a python3 test/browser/ext_test.py`).

  pip install playwright pillow && playwright install chromium
  python3 test/browser/ext_test.py            # uses ../../extension and this folder's page.html
  CHROMIUM_PATH=/path/to/chrome python3 test/browser/ext_test.py   # use a specific browser
  PB_NO_SANDBOX=1 ...                         # needed when running as root in a container
"""
import sys, io, os, tempfile, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "extension")
PAGEDIR = sys.argv[2] if len(sys.argv) > 2 else HERE
PORT = 18931

# Pages for the canvas cases: a 76px transparent header and a white section, short enough that the
# bare canvas shows below them (viewport 1000x800). Only the background setup differs.
def canvas_page(css="", script=""):
    return ("<!doctype html><html><head><meta charset='utf-8'><style>"
            "body{margin:0;font:16px sans-serif} header{height:76px;display:flex;align-items:center;padding:0 20px}"
            ".btn{background:#533afd;color:#fff;padding:10px 16px} .sec{background:#fff;height:400px}" + css +
            "</style></head><body><header><b>careers</b> <span class='btn'>Open roles</span></header>"
            "<main class='sec'>section with its own white background</main>"
            "<script>" + script + "</script></body></html>")
CANVAS_PAGES = {
    "c_nobg.html": canvas_page(),
    "c_bodybg.html": canvas_page("body{background:#eee}"),
    "c_htmlbg.html": canvas_page("html{background:#fff}"),
    "c_dark.html": canvas_page("html{color-scheme:dark}"),
    "c_late.html": canvas_page(script="window.setBg=(v)=>{document.body.style.background=v}"),
    "c_class.html": canvas_page("html.dark body{background:#202020}", "window.toggle=()=>document.documentElement.classList.toggle('dark')"),
}
SERVE = tempfile.mkdtemp()
import shutil
shutil.copy(os.path.join(PAGEDIR, "page.html"), SERVE)
for name, html in CANVAS_PAGES.items():
    open(os.path.join(SERVE, name), "w").write(html)
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SERVE)
h.log_message = lambda *a, **k: None
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", PORT), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
POINTS = {"page body (control)": (900,700), "fixed header": (900,20), "sticky header": (900,80),
          "popover (top layer)": (260,330), "modal dialog (top layer)": (460,330),
          "non-modal dialog": (660,330), "backdrop-filter header": (900,420), "will-change header": (900,480)}
bad = 0
def verdict(name, a, c, want_dim=True):
    global bad
    ok = (c < a - 30) == want_dim
    if not ok: bad += 1
    print(f"{name:34} {a:>5} {c:>6}   {'ok' if ok else 'FAIL'}")
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=os.environ.get("CHROMIUM_PATH") or None, headless=False,
        viewport={"width":1000,"height":800},
        args=(["--no-sandbox"] if os.environ.get("PB_NO_SANDBOX") else []) + [f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
    page = ctx.new_page()
    url = f"http://localhost:{PORT}/page.html"
    page.goto(url)
    def shot(): return Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    page.evaluate("document.getElementById('pop').showPopover(); document.getElementById('dlg').showModal(); document.getElementById('nonmodal').show()")
    page.wait_for_timeout(300); base = shot()
    sw.evaluate("chrome.storage.local.set({'site:localhost:18931': {b: 60, w: 0}})")
    page.wait_for_timeout(600); dim = shot()
    print(f"{'element (brightness 60% set)':34} before  after")
    for n, pt in POINTS.items(): verdict(n, base.getpixel(pt)[0], dim.getpixel(pt)[0])
    badge = sw.evaluate("chrome.tabs.query({}).then(ts => Promise.all(ts.map(t => chrome.action.getBadgeText({tabId: t.id}))))")
    print("toolbar badge texts per tab:", badge)
    # fullscreen
    sw.evaluate("chrome.storage.local.remove('site:localhost:18931')"); page.wait_for_timeout(300)
    page.evaluate("document.getElementById('dlg').close(); document.getElementById('pop').hidePopover()")
    page.click("#fs"); page.evaluate("document.getElementById('fs').requestFullscreen()"); page.wait_for_timeout(500)
    b2 = shot()
    sw.evaluate("chrome.storage.local.set({'site:localhost:18931': {b: 60, w: 0}})"); page.wait_for_timeout(600)
    d2 = shot(); verdict("fullscreen element", b2.getpixel((500,400))[0], d2.getpixel((500,400))[0])
    # leaving fullscreen / removing the setting must restore page and top-layer elements
    sw.evaluate("chrome.storage.local.remove('site:localhost:18931')"); page.wait_for_timeout(600)
    d3 = shot(); verdict("fullscreen back to normal (no dim)", b2.getpixel((500,400))[0], d3.getpixel((500,400))[0], want_dim=False)
    own = page.evaluate("getComputedStyle(document.getElementById('pop')).filter")
    ok = own == "grayscale(1)"; bad += (not ok)
    print(f"{'page-owned filter restored when idle':34} {own!r:>13}   {'ok' if ok else 'FAIL'}")
    # ---- canvas background: pages that set no background on <html> or <body> ----
    page.close()
    KEY = "site:localhost:18931"
    cp = ctx.new_page()
    def cpx(pt): return Image.open(io.BytesIO(cp.screenshot())).convert("RGB").getpixel(pt)[0]
    def load(name):
        sw.evaluate(f"chrome.storage.local.remove('{KEY}')"); cp.goto(f"http://localhost:{PORT}/{name}")
        sw.evaluate(f"chrome.storage.local.set({{'{KEY}': {{b: 60, w: 0}}}})"); cp.wait_for_timeout(700)
    def expect(name, value, lo, hi):
        global bad
        ok = lo <= value <= hi; bad += (not ok)
        print(f"{name:34} {value:>5}   want {lo}-{hi}   {'ok' if ok else 'FAIL'}")
    BAND, SECTION, CANVAS = (500, 38), (500, 300), (500, 700)
    print("\ncanvas cases (brightness 60%: white should read ~153)")
    load("c_nobg.html")
    expect("no bg: header band", cpx(BAND), 140, 165)
    expect("no bg: bare canvas below", cpx(CANVAS), 140, 165)
    expect("no bg: section with own bg", cpx(SECTION), 140, 165)
    load("c_bodybg.html")           # body #eee propagates to the page: 238 * 0.6 = 143
    expect("body bg: propagation intact", cpx(CANVAS), 138, 148)
    expect("body bg: header band", cpx(BAND), 138, 148)
    load("c_htmlbg.html")
    expect("html bg: bare canvas below", cpx(CANVAS), 140, 165)
    load("c_dark.html")             # dark colour-scheme canvas must stay dark, not turn white
    expect("dark scheme: canvas stays dark", cpx(CANVAS), 0, 40)
    load("c_late.html")
    expect("late bg: before", cpx(CANVAS), 140, 165)
    cp.evaluate("setBg('#303030')"); cp.wait_for_timeout(500)
    expect("late bg: body bg added -> propagates", cpx(CANVAS), 0, 40)
    cp.evaluate("setBg('')"); cp.wait_for_timeout(500)
    expect("late bg: removed -> dims again", cpx(CANVAS), 140, 165)
    load("c_class.html")
    cp.evaluate("toggle()"); cp.wait_for_timeout(500)
    expect("theme class on: propagates", cpx(CANVAS), 0, 40)
    cp.evaluate("toggle()"); cp.wait_for_timeout(500)
    expect("theme class off: dims again", cpx(CANVAS), 140, 165)
    sw.evaluate(f"chrome.storage.local.remove('{KEY}')"); cp.wait_for_timeout(500)
    expect("setting removed: back to default", cpx(CANVAS), 250, 255)
    ctx.close()
print("RESULT:", "all ok" if not bad else f"{bad} FAILED")
sys.exit(1 if bad else 0)
