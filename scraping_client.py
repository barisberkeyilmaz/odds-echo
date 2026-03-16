"""
Scraping Client — Playwright + Scrapling
Mackolik sayfaları JS ile oran yüklediği için browser gereklidir.
Playwright (domcontentloaded stratejisi) + Scrapling Selector (CSS parse) kullanır.

Kullanım:
    browser = create_browser()
    page = browser.new_page()
    response = fetch_page(url, page)  # CompatSelector nesnesi döner
    ...
    browser.close()

H2H ve AJAX gibi statik sayfalar için:
    response = fetch_static(url)      # Scrapling Fetcher ile çeker (CompatSelector döner)
"""

import os
from scrapling import Fetcher
try:
    from scrapling import Selector
except ImportError:
    from scrapling import Adaptor as Selector

# Playwright modülleri lazy import (sadece browser gereken işlerde)
_playwright_ctx = None
_fetcher = None

WAIT_FOR_ODDS = os.getenv("WAIT_FOR_ODDS", "true").lower() == "true"
ODDS_TIMEOUT = int(os.getenv("ODDS_TIMEOUT", "10000"))

# --- Uyumluluk katmanı ---
# scrapling 0.4+ css_first yok, .css().first kullanılıyor.
# Hem 0.2.x hem 0.4.x ile çalışması için wrapper.

_HAS_CSS_FIRST = hasattr(Selector("<i>x</i>"), "css_first")


class CompatSelector:
    """scrapling Selector wrapper — css_first() her sürümde çalışır."""

    __slots__ = ("_sel",)

    def __init__(self, sel):
        self._sel = sel

    # --- css / css_first ---
    def css(self, query):
        result = self._sel.css(query)
        if _HAS_CSS_FIRST:
            # 0.2.x: css() zaten list[Adaptor] döner
            return [CompatSelector(el) for el in result] if result else []
        else:
            # 0.4.x: css() Selectors döner
            return [CompatSelector(el) for el in result] if result else []

    def css_first(self, query):
        if _HAS_CSS_FIRST:
            el = self._sel.css_first(query)
            return CompatSelector(el) if el else None
        else:
            result = self._sel.css(query)
            el = result.first if result else None
            return CompatSelector(el) if el else None

    # --- text / attrib / html_content ---
    @property
    def text(self):
        t = self._sel.text
        return t if t else ""

    @property
    def attrib(self):
        return self._sel.attrib

    @property
    def html_content(self):
        if hasattr(self._sel, "html_content"):
            return self._sel.html_content
        if hasattr(self._sel, "extract"):
            return self._sel.extract()
        return str(self._sel)

    def get_all_text(self):
        if hasattr(self._sel, "get_all_text"):
            return self._sel.get_all_text() or ""
        return self.text

    @property
    def body(self):
        if hasattr(self._sel, "body"):
            return self._sel.body
        return self._sel

    def __str__(self):
        return str(self._sel)

    def __bool__(self):
        return self._sel is not None


def _wrap(sel):
    """Scrapling nesnesini CompatSelector'a sarar."""
    return CompatSelector(sel) if sel is not None else None


# --- Browser yönetimi ---

def create_browser(headless=True):
    """Playwright browser başlatır. Çağıran kapanıştan sorumludur."""
    from playwright.sync_api import sync_playwright

    global _playwright_ctx
    _playwright_ctx = sync_playwright().start()
    browser = _playwright_ctx.chromium.launch(headless=headless)
    return browser


def close_browser(browser):
    """Browser ve playwright context'i kapatır."""
    global _playwright_ctx
    try:
        browser.close()
    except Exception:
        pass
    if _playwright_ctx:
        try:
            _playwright_ctx.stop()
        except Exception:
            pass
        _playwright_ctx = None


def fetch_page(url, page):
    """
    Playwright page ile URL'yi çeker, CompatSelector döner.
    page_load_strategy = 'eager' eşdeğeri: domcontentloaded.
    """
    page.goto(url, wait_until="domcontentloaded", timeout=30000)

    if WAIT_FOR_ODDS:
        try:
            page.wait_for_selector("div.md", timeout=ODDS_TIMEOUT)
        except Exception:
            pass  # Tüm maçlarda oran olmayabilir

    # AJAX verilerinin (skor, HT skor vb.) yüklenmesi için kısa bekleme
    import time
    time.sleep(1.5)

    html = page.content()
    return _wrap(Selector(html))


def fetch_static(url):
    """
    Statik sayfa çeker (browser gerektirmeyen: AJAX, H2H vb.).
    Scrapling Fetcher kullanır, bağlantı hatalarında requests'e fallback yapar.
    CompatSelector döner.
    """
    global _fetcher
    if _fetcher is None:
        _fetcher = Fetcher()
    try:
        resp = _fetcher.get(url)
        return _wrap(resp)
    except Exception:
        # curl_cffi bağlantı hatası — requests ile fallback
        import requests as _req
        r = _req.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
        r.raise_for_status()
        return _wrap(Selector(r.text))
