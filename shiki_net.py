"""Все запросы к shikimori.io идут через этот модуль.

Shikimori разрешает не больше 5 запросов в секунду и 90 в минуту, а сверх этого отвечает
429 Too Many Requests. Поэтому здесь общий для всего Animax счётчик: пауза между запросами,
окно в минуту и повтор после 429. Фоновые запросы (обход коллекций) занимают не больше
половины минутного лимита, чтобы страницы, которые открывает пользователь, не ждали.
"""
from __future__ import annotations

import collections
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

GAP = 0.25            # не чаще 4 запросов в секунду
PER_MINUTE = 80       # с запасом до 90
BACKGROUND_SHARE = 40  # столько из них может занять фоновый обход
RETRIES = 3

_lock = threading.Lock()
_calls: collections.deque[float] = collections.deque()


def _throttle(background: bool) -> None:
    limit = BACKGROUND_SHARE if background else PER_MINUTE
    while True:
        with _lock:
            now = time.time()
            while _calls and now - _calls[0] > 60:
                _calls.popleft()
            wait = 0.0
            if _calls:
                wait = GAP - (now - _calls[-1])
            if len(_calls) >= limit:
                wait = max(wait, 60 - (now - _calls[-limit]))
            if wait <= 0:
                _calls.append(now)
                return
        time.sleep(min(wait, 1.0))


# Картинки (постеры, кадры) — обычные файлы, под лимит API не попадают: только не больше 6 загрузок разом.
_img_slots = threading.Semaphore(6)

# Хост картинок недоступен (например, заблокирован YouTube с его превью роликов): каждая попытка висела бы
# до таймаута и занимала одно из 6 мест загрузки — постеры Shikimori ждали бы в очереди за ними.
# Поэтому после 3 неудач подряд хост «отдыхает» 5 минут, и на его картинки отвечаем сразу.
HOST_FAILS, HOST_PAUSE = 3, 300
_host_fail: dict[str, int] = {}
_host_down: dict[str, float] = {}


def fetch_image(url: str, user_agent: str, timeout: int | None = None) -> bytes:
    host = urllib.parse.urlsplit(url).hostname or ""
    if time.time() < _host_down.get(host, 0):
        raise urllib.error.URLError(f"{host} временно недоступен")
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    try:
        with _img_slots, urllib.request.urlopen(req, timeout=timeout or (30 if host.endswith("shikimori.io") else 10)) as r:
            data = r.read()
    except urllib.error.HTTPError:
        _host_fail.pop(host, None)  # хост ответил (пусть и 404) — значит, он доступен
        raise
    except OSError:  # URLError, таймаут, обрыв соединения
        with _lock:
            _host_fail[host] = _host_fail.get(host, 0) + 1
            if _host_fail[host] >= HOST_FAILS:
                _host_fail[host] = 0
                _host_down[host] = time.time() + HOST_PAUSE
        raise
    _host_fail.pop(host, None)
    return data


def open_url(req: urllib.request.Request, timeout: int = 20, background: bool = False) -> tuple[int, bytes]:
    """Выполняет запрос с паузами и повтором после 429. Ответ с ошибкой (кроме 429) — исключение HTTPError."""
    for attempt in range(RETRIES + 1):
        _throttle(background)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == RETRIES:
                raise
            try:
                delay = float(e.headers.get("Retry-After") or 0)
            except ValueError:
                delay = 0
            time.sleep(max(delay, 1.0 + attempt * 2))
    raise AssertionError("unreachable")
