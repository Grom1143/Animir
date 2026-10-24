"""Проверка интерфейса в настоящем браузере: все экраны, поиск, страница тайтла, повтор картинок, защита сервера.

Запуск: python tests/ui_smoke.py   (нужны интернет и Playwright: pip install playwright)
Браузер — установленный Edge, скачивать Chromium не нужно. Сервер поднимается на свободном порту
с временной папкой данных — настоящие закладки не трогаются. Скриншоты — в папке, которую напечатает скрипт.

Не входит в `unittest discover`: зависит от сети и Shikimori. Ответы 502 от /api/* — это сбой связи
с Shikimori, они показываются отдельно и проверку не роняют.
"""
import collections
import http.client
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SCREENS = [
    ("home", "#/"), ("discover", "#/discover"), ("bookmarks", "#/bookmarks"),
    ("library", "#/library"), ("profile", "#/profile"), ("recs", "#/recs"),
    ("schedule", "#/schedule"), ("collections", "#/collections"),
    ("history", "#/bookmarks?tab=history"), ("notifications", "#/notifications"),
    ("settings", "#/settings"),
]
# экран загружен, когда пропали заглушки карточек и общий индикатор «Загрузка…»
LOADED = "() => !document.querySelector('.skcard, .skeleton, #view > .loading')"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port: int, data: str) -> subprocess.Popen:
    env = {**os.environ, "APPDATA": data}
    proc = subprocess.Popen([sys.executable, "server.py", str(port)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1).read()
            return proc
        except OSError:
            time.sleep(0.5)
    proc.kill()
    raise RuntimeError("сервер не запустился")


def settle(page) -> bool:
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except PWTimeout:
        pass  # приложение всё время что-то подгружает — тишины в сети может и не быть
    try:
        page.wait_for_function(LOADED, timeout=40000)
    except PWTimeout:
        return False
    page.wait_for_timeout(300)
    return True


def raw_status(port: int, method: str, host: str = "", origin: str = "") -> int:
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.putrequest(method, "/api/state", skip_host=True)
    c.putheader("Host", host or f"127.0.0.1:{port}")
    if origin:
        c.putheader("Origin", origin)
    c.putheader("Content-Length", "0")
    c.endheaders()
    status = c.getresponse().status
    c.close()
    return status


def walk(p, base: str, shots: Path) -> tuple[list, list]:
    errors, network = [], []
    where = ["start"]

    def on_response(r):
        if not r.url.startswith(base) or r.status < 400:
            return
        item = (where[0], f"HTTP {r.status} {r.url[len(base) - 1:][:120]}")
        (network if r.status in (502, 504) else errors).append(item)

    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: errors.append((where[0], f"JS: {e}")))
    page.on("response", on_response)
    page.goto(base)
    settle(page)
    for name, hash_ in SCREENS:
        where[0] = name
        page.evaluate("h => { location.hash = h }", hash_)
        ok = settle(page)
        page.screenshot(path=str(shots / f"{name}.png"))
        print(f"  {'OK ' if ok else '...'} {name:14} карточек: {page.locator('a.card').count()}"
              + ("" if ok else "  (не догрузился за 40 с)"))

    where[0] = "search"
    box = page.locator("input[type=search], input[placeholder*='оиск']").first
    box.click()
    box.fill("Frieren")
    box.press("Enter")
    settle(page)
    cards = page.locator("a.card[href^='#/anime/']")
    print(f"  {'OK ' if cards.count() else 'ERR'} search         найдено: {cards.count()}")
    if not cards.count():
        errors.append(("search", "поиск «Frieren» ничего не нашёл"))
    else:
        where[0] = "anime-page"
        cards.first.click()
        settle(page)
        page.screenshot(path=str(shots / "anime-page.png"))
        print(f"  OK  anime-page     {page.locator('#view h1').first.inner_text()[:40]!r}")
    browser.close()
    return errors, network


def image_retry(p, base: str) -> list:
    """Первая загрузка каждой картинки «падает» — повторная попытка из ui.js должна её спасти."""
    tries = collections.Counter()

    def flaky(route):
        key = route.request.url.replace("&retry=1", "")
        tries[key] += 1
        if tries[key] == 1:
            route.fulfill(status=404, body="")
        else:
            route.continue_()

    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.route("**/img?**", flaky)
    page.goto(base)
    page.wait_for_function("() => document.querySelectorAll('a.card').length > 0", timeout=60000)
    page.wait_for_function("""() => { const im = [...document.querySelectorAll('a.card img')].filter(i => i.dataset.retried);
        return im.length > 0 && im.every(i => i.dataset.fallback || (i.complete && i.naturalWidth)); }""", timeout=90000)
    got = page.evaluate("""() => { const im = [...document.querySelectorAll('a.card img')].filter(i => i.dataset.retried);
        return [im.length, im.filter(i => !i.dataset.fallback).length]; }""")
    browser.close()
    print(f"  {'OK ' if got[0] and got[0] == got[1] else 'ERR'} повтор картинок: со второй попытки загрузилось {got[1]} из {got[0]}")
    return [] if got[0] and got[0] == got[1] else [("images", f"после повтора загрузилось {got[1]} из {got[0]}")]


def main() -> int:
    port = free_port()
    base = f"http://127.0.0.1:{port}/"
    data = tempfile.mkdtemp(prefix="animax-ui-")
    shots = Path(data) / "shots"
    shots.mkdir()
    proc = start_server(port, data)
    try:
        print("Экраны:")
        with sync_playwright() as p:
            errors, network = walk(p, base, shots)
            errors += image_retry(p, base)
        print("Защита сервера:")
        for label, got, want in (
            ("чужой Host (DNS rebinding)", raw_status(port, "GET", host="evil.com"), 403),
            ("POST с чужим Origin", raw_status(port, "POST", origin="https://evil.com"), 403),
        ):
            print(f"  {'OK ' if got == want else 'ERR'} {label}: HTTP {got}")
            if got != want:
                errors.append(("security", f"{label}: HTTP {got}, ждали {want}"))
    finally:
        proc.terminate()
        proc.wait()
    for screen, text in network:
        print(f"  сеть: [{screen}] {text}")
    for screen, text in errors:
        print(f"  ОШИБКА: [{screen}] {text}")
    print(f"\nСкриншоты: {shots}\n{'Всё в порядке' if not errors else f'Ошибок: {len(errors)}'}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
