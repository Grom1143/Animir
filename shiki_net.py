"""Все запросы к shikimori.io идут через этот модуль.

Shikimori разрешает не больше 5 запросов в секунду и 90 в минуту, а сверх этого отвечает
429 Too Many Requests. Поэтому здесь общий для всего Animax счётчик: пауза между запросами,
окно в минуту и повтор после 429. Фоновые запросы (обход коллекций) занимают не больше
половины минутного лимита, чтобы страницы, которые открывает пользователь, не ждали.
"""
from __future__ import annotations

import collections
import http.client
import io
import ssl
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
# Сам Shikimori не выключаем: с него все постеры, и пара медленных ответов (картинка бывает идёт почти
# минуту) оставила бы Animax без картинок на 5 минут.
HOST_FAILS, HOST_PAUSE = 3, 300
_host_fail: dict[str, int] = {}
_host_down: dict[str, float] = {}


# ---------- соединения ----------
# Через VPN TLS-рукопожатие с Shikimori идёт 4–10 с, а сам запрос — 0,3 с. urllib открывает новое соединение
# на каждый запрос (и шлёт «Connection: close»), поэтому соединения держим открытыми и берём повторно.
IDLE_MAX = 45   # сек.: Shikimori закрывает соединение после 60 с простоя (Keep-Alive: timeout=60)
POOL_MAX = 8    # столько простаивающих соединений храним на один хост
_PROXIES = urllib.request.getproxies()  # если в системе настроен прокси — ходим, как раньше, через urllib
_ssl_ctx = ssl.create_default_context()
_idle: dict[tuple[str, str, int], list[tuple[http.client.HTTPConnection, float]]] = {}


def _origin(url: str) -> tuple[str, str, int]:
    """Схема, хост и порт — «происхождение» адреса; по нему же различаются соединения в запасе."""
    parts = urllib.parse.urlsplit(url)
    return parts.scheme, parts.hostname or "", parts.port or (443 if parts.scheme == "https" else 80)


def _same_origin(a: str, b: str) -> bool:
    return _origin(a) == _origin(b)


def _new_conn(key: tuple[str, str, int], timeout: float) -> http.client.HTTPConnection:
    scheme, host, port = key
    if scheme == "https":
        return http.client.HTTPSConnection(host, port, timeout=timeout, context=_ssl_ctx)
    return http.client.HTTPConnection(host, port, timeout=timeout)


def _take(key: tuple[str, str, int], timeout: float, fresh: bool) -> tuple[http.client.HTTPConnection, bool]:
    """Соединение из запаса (True) или новое (False)."""
    if not fresh:
        now = time.time()
        with _lock:
            idle = _idle.get(key, [])
            while idle:
                conn, used = idle.pop()
                if now - used < IDLE_MAX and conn.sock:
                    conn.sock.settimeout(timeout)
                    return conn, True
                conn.close()
    return _new_conn(key, timeout), False


def _give_back(key: tuple[str, str, int], conn: http.client.HTTPConnection) -> None:
    now = time.time()
    to_close = []
    with _lock:
        # заодно выбрасываем пролежавшие дольше IDLE_MAX у всех хостов: сервер их уже закрыл, а сокеты висели бы
        for idle in _idle.values():
            to_close += [c for c, used in idle if now - used >= IDLE_MAX]
            idle[:] = [(c, used) for c, used in idle if now - used < IDLE_MAX]
        idle = _idle.setdefault(key, [])
        if len(idle) < POOL_MAX:
            idle.append((conn, now))
        else:
            to_close.append(conn)
    for c in to_close:
        c.close()


def close_idle() -> None:
    with _lock:
        conns = [c for idle in _idle.values() for c, _ in idle]
        _idle.clear()
    for c in conns:
        c.close()


def warm_up(url: str, n: int = 4) -> None:
    """Заранее открыть n соединений, чтобы первый экран не ждал TLS-рукопожатий (по ~5 с каждое)."""
    if _PROXIES:
        return
    key = _origin(url)

    def one():
        conn = _new_conn(key, 30)
        try:
            conn.connect()
        except OSError:
            conn.close()
            return
        _give_back(key, conn)

    for _ in range(n):
        threading.Thread(target=one, daemon=True).start()


def _exchange(key, method: str, path: str, body: bytes | None, headers: dict, timeout: float, idempotent: bool):
    while True:
        # что-то меняющий запрос — только по новому соединению: при обрыве на старом он мог дойти дважды
        conn, reused = _take(key, timeout, fresh=not idempotent)
        try:
            conn.request(method, path, body=body, headers=headers)
            r = conn.getresponse()
            data = r.read()
        except (OSError, http.client.HTTPException) as e:
            conn.close()
            if reused and not isinstance(e, TimeoutError):
                # соединение из запаса сервер уже закрыл (обрыв, SSL EOF) — повторяем по другому;
                # таймаут не повторяем: сервер просто медленный, второй раз ждали бы столько же
                continue
            raise urllib.error.URLError(e) from e
        if r.will_close:
            conn.close()
        else:
            _give_back(key, conn)
        return r, data


def _urlopen(req: urllib.request.Request, timeout: float, idempotent: bool | None = None) -> tuple[int, bytes]:
    """Как urllib.request.urlopen(req).read(), но по сохранённому соединению.

    Ответ с ошибкой — HTTPError (с телом), обрыв и таймаут — URLError, переадресации выполняются.
    """
    if _PROXIES:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    method, url, body = req.get_method(), req.full_url, req.data
    if idempotent is None:
        idempotent = method in ("GET", "HEAD")
    headers = dict(req.header_items())
    if body is not None and not any(k.lower() == "content-type" for k in headers):
        headers["Content-Type"] = "application/x-www-form-urlencoded"  # так делает urllib
    for _ in range(6):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https"):
            raise urllib.error.URLError(f"неподдерживаемый адрес: {url}")
        path = (parts.path or "/") + ("?" + parts.query if parts.query else "")
        r, data = _exchange(_origin(url), method, path, body, headers, timeout, idempotent)
        location = r.getheader("Location")
        if r.status in (301, 302, 303, 307, 308) and location:
            new = urllib.parse.urljoin(url, location)
            if not _same_origin(new, url):
                # токен Shikimori не должен уйти ни на чужой сайт, ни на другой порт, ни по http открытым текстом
                headers = {k: v for k, v in headers.items() if k.lower() not in ("authorization", "cookie")}
            if r.status == 303 or (r.status in (301, 302) and method == "POST"):
                method, body = "GET", None
                headers = {k: v for k, v in headers.items() if k.lower() not in ("content-type", "content-length")}
            url = new
            continue
        if r.status >= 400:
            raise urllib.error.HTTPError(url, r.status, r.reason, r.msg, io.BytesIO(data))
        return r.status, data
    raise urllib.error.URLError(f"слишком много переадресаций: {url}")


def urlopen_pooled(req: urllib.request.Request, timeout: float,
                   idempotent: bool | None = None) -> tuple[int, bytes]:
    """Запрос по сохранённому соединению без пауз Shikimori — для онлайн-озвучек (sources.py).

    В отличие от open_url не вызывает _throttle: у sources.py своя вежливая пауза _wait_turn
    перед каждым обращением к сайту. Ошибки и переадресации — как у _urlopen.
    """
    return _urlopen(req, timeout, idempotent)


def fetch_image(url: str, user_agent: str, timeout: int | None = None) -> bytes:
    host = urllib.parse.urlsplit(url).hostname or ""
    if time.time() < _host_down.get(host, 0):
        raise urllib.error.URLError(f"{host} временно недоступен")
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    try:
        with _img_slots:
            data = _urlopen(req, timeout or (30 if host.endswith("shikimori.io") else 10))[1]
    except urllib.error.HTTPError:
        _host_fail.pop(host, None)  # хост ответил (пусть и 404) — значит, он доступен
        raise
    except OSError:  # URLError, таймаут, обрыв соединения
        if not host.endswith("shikimori.io"):
            with _lock:
                _host_fail[host] = _host_fail.get(host, 0) + 1
                if _host_fail[host] >= HOST_FAILS:
                    _host_fail[host] = 0
                    _host_down[host] = time.time() + HOST_PAUSE
        raise
    _host_fail.pop(host, None)
    return data


def open_url(req: urllib.request.Request, timeout: int = 20, background: bool = False,
             idempotent: bool | None = None) -> tuple[int, bytes]:
    """Выполняет запрос с паузами и повтором после 429. Ответ с ошибкой (кроме 429) — исключение HTTPError.

    idempotent=True — запрос ничего не меняет (GraphQL-запрос на чтение) и его можно слать по старому соединению;
    по умолчанию так считаются только GET и HEAD.
    """
    for attempt in range(RETRIES + 1):
        _throttle(background)
        try:
            return _urlopen(req, timeout, idempotent)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == RETRIES:
                raise
            try:
                delay = float(e.headers.get("Retry-After") or 0)
            except ValueError:
                delay = 0
            time.sleep(max(delay, 1.0 + attempt * 2))
    raise AssertionError("unreachable")
