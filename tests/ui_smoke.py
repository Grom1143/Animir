"""Проверка интерфейса в настоящем браузере: все экраны, поиск, страница тайтла, повтор картинок, окно плеера,
защита сервера.

Запуск: python tests/ui_smoke.py   (нужны интернет и Playwright: pip install playwright)
Браузер - установленный Edge, скачивать Chromium не нужно. Сервер поднимается на свободном порту
с временной папкой данных - настоящие закладки не трогаются. Скриншоты - в папке, которую напечатает скрипт.

Не входит в `unittest discover`: зависит от сети и Shikimori. Ответы 502 от /api/* - это сбой связи
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
import uuid
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
    env = {**os.environ, "APPDATA": data, "PYTHONPATH": str(ROOT / "src")}
    proc = subprocess.Popen([sys.executable, "-m", "animir.server", str(port)], cwd=ROOT, env=env,
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
        pass  # приложение всё время что-то подгружает - тишины в сети может и не быть
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
    """Первая загрузка каждой картинки «падает» - повторная попытка из ui.js должна её спасти."""
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


def player_choice(p, base: str) -> list:
    """Настройка «Окно плеера» и правило «видео одновременно одно»: вопрос «Переключить?» перед новой серией.
    Окна плеера в браузере нет - ответы сервера о нём подменяем, сеть Shikimori тут не нужна."""
    errors, calls = [], []
    playing = '{"open": true, "title": "Анимир · Фрирен - серия 1", "hash": "#/watch?o=52991&e=1&w=1"}'

    def check(ok, label):
        print(f"  {'OK ' if ok else 'ERR'} {label}")
        if not ok:
            errors.append(("player", label))

    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.route("**/api/player", lambda r: r.fulfill(status=200, content_type="application/json", body=playing))
    def answer(path):
        def handler(route, *_):  # Playwright передаёт (route, request) - второй нам не нужен
            calls.append((path, route.request.post_data or ""))
            route.fulfill(status=200, content_type="application/json", body='{"ok": true}')
        return handler

    for path in ("open-window", "player/close"):
        page.route(f"**/api/{path}", answer(path))
    page.goto(base + "#/settings?s=play")
    settle(page)
    check(page.evaluate("() => S.settings.playerWindow") == "main", "по умолчанию плеер - в основном окне")
    page.locator("label:has(input[name=pw][value=separate])").click()
    page.wait_for_timeout(300)
    check(page.evaluate("() => S.settings.playerWindow") == "separate", "настройка переключается на «отдельное окно»")

    def ask(answer: str) -> str:
        page.evaluate("() => { watchOpen('#/watch?o=52991&e=2'); }")
        h3 = page.locator("#modal-box h3")
        h3.wait_for(timeout=5000)
        text = h3.inner_text()
        page.locator(f"#modal-box [data-{answer}]").click()
        page.wait_for_timeout(400)
        return text

    calls.clear()
    text = ask("n")
    check("Фрирен - серия 1" in text and "серию 2" in text, f"вопрос: {text.replace(chr(10), ' ')!r}")
    check(not calls, "«Отмена» - ничего не открыли")
    ask("y")
    check(any(c[0] == "open-window" and "e=2" in c[1] and "w=1" in c[1] for c in calls),
          "«Переключить» в режиме отдельного окна - окно плеера переключено на серию 2")
    page.evaluate("() => { S.settings.playerWindow = 'main'; }")
    calls.clear()
    ask("y")
    check([c[0] for c in calls] == ["player/close"] and page.evaluate("() => location.hash").startswith("#/watch?o=52991&e=2"),
          "«Переключить» в режиме основного окна - окно плеера закрыто, серия 2 здесь")
    # Кнопки плеера (нужен живой поток серии - без интернета пропускаем)
    try:
        page.locator("#b-pin").wait_for(timeout=15000)
        check("on" not in page.get_attribute("#b-pin", "class").split(), "📌 «поверх всех» по умолчанию выключено")
        check(page.locator("#b-pip").is_visible(), "кнопка «картинка в картинке» видна (P)")
    except Exception:  # noqa: BLE001
        print("  -- плеер не открылся (нет сети?) - кнопки не проверены")
    browser.close()
    return errors


def year_page(p, base: str) -> list:
    """«Мой год в аниме»: итоги считаются из журнала отмеченных серий; чужой год в счёт не идёт."""
    errors = []

    def check(ok, label):
        print(f"  {'OK ' if ok else 'ERR'} {label}")
        if not ok:
            errors.append(("year", label))

    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: errors.append(("year", f"JS: {e}")))
    page.goto(base)
    settle(page)
    page.evaluate("""() => {
      const at = (m, d, h = 20) => new Date(2025, m, d, h).getTime();
      S.list = {
        1: { anime: { id: 1, russian: 'Тест А', kind: 'tv', duration: 24, genres: ['Драма', 'Фэнтези'] }, status: 'completed', statusAt: at(2, 20), score: 4, ep: 10 },
        2: { anime: { id: 2, russian: 'Тест Б', kind: 'tv', duration: 12, genres: ['Драма'] }, status: 'watching', ep: 5 },
      };
      S.watchLog = [{ at: new Date(2024, 11, 31).getTime(), id: 1, ep: 0 }];
      for (let i = 1; i <= 10; i++) S.watchLog.push({ at: at(2, i), id: 1, ep: i });   // март, по серии в день
      for (let i = 1; i <= 5; i++) S.watchLog.push({ at: at(6, 1, 2), id: 2, ep: i });  // июль, ночью
      go('#/year?y=2025');
    }""")
    page.locator("[data-stat=eps]").wait_for(timeout=5000)
    stat = lambda k: page.locator(f"[data-stat={k}]").inner_text().strip()
    check(stat("eps") == "15", f"серий за год: {stat('eps')} (ждали 15, серия 2024 года не в счёт)")
    check(stat("time") == "5 ч", f"время: {stat('time')} (10×24 + 5×12 мин = 5 ч)")
    check(stat("titles") == "2", f"тайтлов: {stat('titles')}")
    check(stat("done") == "1", f"досмотрено: {stat('done')}")
    check(stat("streak") == "10", f"дней подряд: {stat('streak')}")
    check(page.locator("[data-top-genre]").inner_text().strip() == "Драма", "главный жанр - Драма")
    check("март" in page.locator("[data-peak-month]").inner_text().lower(), "самый насыщенный месяц - март")
    check(page.locator("[data-top-title]").first.inner_text().find("Тест А") >= 0, "чаще всего смотрел - «Тест А»")
    page.screenshot(path=str(Path(tempfile.gettempdir()) / "animir-year.png"), full_page=True)
    browser.close()
    return errors


def resume_card(p, base: str) -> list:
    """Главная: крупная карточка «Продолжить с того места» - последняя недосмотренная серия, с серией и временем."""
    errors = []

    def check(ok, label):
        print(f"  {'OK ' if ok else 'ERR'} {label}")
        if not ok:
            errors.append(("resume", label))

    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: errors.append(("resume", f"JS: {e}")))
    page.goto(base)
    settle(page)
    page.evaluate("""() => {
      const now = Date.now();
      const fr = { id: 52991, russian: 'Фрирен', poster: '', episodes: 28, duration: 24, kind: 'tv' };
      S.history = [
        { file: 'o:52991:AniLibria:5', name: 'Серия 5', dub: 'AniLibria', ep: 5, anime: fr, at: now },
        { file: 'o:52991:AniLibria:4', name: 'Серия 4', dub: 'AniLibria', ep: 4, anime: fr, at: now - 1e5 },
      ];
      S.progress = { 'o:52991:AniLibria:5': { t: 750, d: 1420, done: false, at: now }, 'o:52991:AniLibria:4': { t: 1400, d: 1420, done: true, at: now - 1e5 } };
      S.settings.playerWindow = 'main';  // соседний тест мог оставить «отдельное окно» - тогда серия уйдёт туда
      save(); location.hash = '#/'; route();
    }""")
    box = page.locator("#resume")
    try:
        box.wait_for(timeout=40000)
    except Exception:  # noqa: BLE001
        check(False, "карточка «Продолжить» не появилась (главная не загрузилась?)")
        browser.close()
        return errors
    text = box.inner_text()
    check("Фрирен" in text and "5 серия" in text, f"тайтл и серия: {text[:60]!r}")
    check("12:30" in text and "23:40" in text, "время: 12:30 из 23:40")
    check("o=52991" in (box.locator("a.resume-play").get_attribute("href") or "") and "e=5" in box.locator("a.resume-play").get_attribute("href"),
          "кнопка ведёт на серию 5")
    page.locator("#resume a.resume-play").click()
    page.wait_for_timeout(500)
    check(page.evaluate("() => location.hash").startswith("#/watch?o=52991"), "по кнопке открылась серия")
    page.goto(base)  # вернём главную для снимка
    page.locator("#resume").wait_for(timeout=40000)
    settle(page)
    page.screenshot(path=str(Path(tempfile.gettempdir()) / "animir-resume.png"))
    browser.close()
    return errors


def sky_theme(p, base: str) -> list:
    """Фон «мира» по времени суток: утро, день, закат, ночь; выключатель в «Внешнем виде»."""
    errors = []

    def check(ok, label):
        print(f"  {'OK ' if ok else 'ERR'} {label}")
        if not ok:
            errors.append(("sky", label))

    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: errors.append(("sky", f"JS: {e}")))
    page.goto(base + "#/settings?s=look")
    settle(page)
    got = page.evaluate("() => [4, 6, 12, 18, 22].map(skyOf)")
    check(got == ["night", "morning", "day", "evening", "night"], f"фазы по часам 4/6/12/18/22: {got}")
    check(page.evaluate("() => document.documentElement.dataset.sky") == page.evaluate("() => skyOf(new Date().getHours())"),
          "по умолчанию фон следует за часами")
    page.locator("label.switch:has(#sky)").click()
    page.wait_for_timeout(300)
    check(page.evaluate("() => document.documentElement.dataset.sky") is None and page.evaluate("() => S.settings.sky") is False,
          "выключатель «Небо по времени суток» убирает фон")
    page.locator("label.switch:has(#sky)").click()
    page.wait_for_timeout(300)
    for phase in ("morning", "evening", "night"):
        page.evaluate("ph => { document.documentElement.dataset.sky = ph }", phase)
        page.goto(base + "#/")
        page.evaluate("ph => { document.documentElement.dataset.sky = ph }", phase)
        settle(page)
        page.evaluate("ph => { document.documentElement.dataset.sky = ph }", phase)
        page.wait_for_timeout(300)
        page.screenshot(path=str(Path(tempfile.gettempdir()) / f"animir-sky-{phase}.png"))
    browser.close()
    return errors


def main() -> int:
    port = free_port()
    base = f"http://127.0.0.1:{port}/"
    # не tempfile.mkdtemp: его права «только владелец» не пускают песочницу  (см. test_server.py)
    data = str(Path(tempfile.gettempdir()) / f"animir-ui-{uuid.uuid4().hex[:8]}")
    shots = Path(data) / "shots"
    shots.mkdir(parents=True)
    proc = start_server(port, data)
    try:
        print("Экраны:")
        with sync_playwright() as p:
            errors, network = walk(p, base, shots)
            errors += image_retry(p, base)
            print("Окно плеера:")
            errors += player_choice(p, base)
            print("Мой год в аниме:")
            errors += year_page(p, base)
            print("Продолжить с того места:")
            errors += resume_card(p, base)
            print("Небо по времени суток:")
            errors += sky_theme(p, base)
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
