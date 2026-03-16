"""
Scraping Client — Playwright + Scrapling
Mackolik sayfaları JS ile oran yüklediği için browser gereklidir.
Playwright (domcontentloaded stratejisi) + Scrapling Selector (CSS parse) kullanır.

Kullanım:
    browser = create_browser()
    page = browser.new_page()
    response = fetch_page(url, page)  # Selector nesnesi döner
    ...
    browser.close()

H2H ve AJAX gibi statik sayfalar için:
    response = fetch_static(url)      # Scrapling Fetcher ile çeker
"""

import os
from scrapling import Fetcher

# Scrapling 0.4+ Selector, eski sürümlerde Adaptor
try:
    from scrapling import Selector as _Parser
except ImportError:
    from scrapling import Adaptor as _Parser

# Playwright modülleri lazy import (sadece browser gereken işlerde)
_playwright_ctx = None
_fetcher = None

WAIT_FOR_ODDS = os.getenv("WAIT_FOR_ODDS", "true").lower() == "true"
ODDS_TIMEOUT = int(os.getenv("ODDS_TIMEOUT", "10000"))


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
    Playwright page ile URL'yi çeker, Scrapling Selector döner.
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
    return _Parser(html)


def fetch_static(url):
    """
    Statik sayfa çeker (browser gerektirmeyen: AJAX, H2H vb.).
    Scrapling Fetcher kullanır.
    """
    global _fetcher
    if _fetcher is None:
        _fetcher = Fetcher()
    return _fetcher.get(url)
