"""Сеть для онлайн-источников: вежливые паузы по сайтам, повторы, кэш ответов в памяти."""

import json
import threading
import time
import urllib.parse
import urllib.request

import shiki_net


USER_AGENT = "Animir desktop (personal use)"
SHIKI = "https://shikimori.io"

# Вежливая пауза между запросами - своя у каждого сайта: раньше она была общей, и Kodik с AniLiberty
# ждали в одной очереди с тридцатью запросами к Anixart. Поток бронирует себе время запроса и спит
# уже без блокировки, поэтому параллельные запросы к разным сайтам друг друга не тормозят.
THROTTLE = threading.Lock()
GAP = 0.15  # не чаще ~7 запросов в секунду к одному сайту
_last: dict[str, float] = {}


def _wait_turn(url: str) -> None:
    host = urllib.parse.urlsplit(url).hostname or ""
    with THROTTLE:
        now = time.time()
        slot = max(now, _last.get(host, 0.0) + GAP)
        _last[host] = slot
    if slot > now:
        time.sleep(slot - now)


class SourceError(Exception):
    pass


def _http(url: str, method: str = "GET", data: bytes | None = None,
          content_type: str = "", tries: int = 2, timeout: int = 20) -> bytes:
    """Браузерный запрос с вежливой паузой между обращениями."""
    result = b""
    for attempt in range(1, tries + 1):
        _wait_turn(url)
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120) Gecko/20100101 Firefox/120",
                "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "ru,en;q=0.8",
            }
            if data is not None and content_type:
                headers["Content-Type"] = content_type
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            result = shiki_net.urlopen_pooled(req, timeout, idempotent=True)[1]
            break
        except Exception:
            if attempt == tries:
                raise
    return result


def _get(url: str, tries: int = 2, timeout: int = 20) -> str:
    return _http(url, tries=tries, timeout=timeout).decode("utf-8", "replace")


def _post_form(url: str, fields: dict) -> dict:
    body = urllib.parse.urlencode(fields).encode()
    raw = _http(url, "POST", body, "application/x-www-form-urlencoded", tries=2)
    return json.loads(raw.decode("utf-8", "replace"))


# ---------------- кэш (TTL в памяти процесса) ----------------
_cache_lock = threading.Lock()
_cache_data: dict[str, tuple[float, object]] = {}


def cached(key: str, ttl: int, fetch):
    with _cache_lock:
        hit = _cache_data.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    data = fetch()
    if data is not None:
        with _cache_lock:
            if len(_cache_data) > 400:
                for k in list(_cache_data)[:100]:
                    _cache_data.pop(k, None)
            _cache_data[key] = (time.time(), data)
    return data


def _safe(fn, *args, default=None):
    """Вызов, ошибка которого не должна ронять соседние запросы (параллельные загрузки)."""
    try:
        return fn(*args)
    except Exception:  # noqa: BLE001 - одна недоступная озвучка не повод терять остальные
        return default


