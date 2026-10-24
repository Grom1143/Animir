"""Animax — данные с Shikimori для сервера: запросы, кэш ответов (в памяти и на диске), отзывы, коллекции."""
import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import reviews
import shiki_colls
import shiki_net
from config import API_DISK, DATA_DIR, SHIKI, USER_AGENT
from state import lite_mode

_api_cache: dict[str, tuple[float, bytes]] = {}
API_TTL = 600
DISK_TTL = 24 * 3600
DISK_CACHED = re.compile(r"^rest:/api/animes/\d+/(similar|franchise)$")


def upstream(url: str, body: bytes | None = None, timeout: int = 20) -> bytes:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers)
    return shiki_net.open_url(req, timeout)[1]


def _disk_file(key: str) -> Path:
    return API_DISK / (hashlib.sha1(key.encode()).hexdigest() + ".json")


API_CACHE_MAX = 300  # ответов в памяти; раньше просроченные не удалялись и копились, пока Animax открыт


def _remember(key: str, data: bytes) -> None:
    _api_cache[key] = (time.time(), data)
    if len(_api_cache) > API_CACHE_MAX:
        now = time.time()
        for k in [k for k, (t, _) in _api_cache.items() if now - t >= API_TTL]:
            _api_cache.pop(k, None)
        # всё ещё много — выкидываем самые старые (словарь помнит порядок добавления)
        for k in list(_api_cache)[:max(0, len(_api_cache) - API_CACHE_MAX)]:
            _api_cache.pop(k, None)


def cached_api(key: str, fetch) -> bytes:
    hit = _api_cache.get(key)
    if hit and time.time() - hit[0] < API_TTL:
        return hit[1]
    disk = _disk_file(key) if DISK_CACHED.match(key) else None
    if disk:
        try:
            if time.time() - disk.stat().st_mtime < DISK_TTL:
                data = disk.read_bytes()
                _remember(key, data)
                return data
        except OSError:
            pass
    data = fetch()
    _api_cache.pop(key, None)  # свежая запись — в конец, чтобы не выкинуть её первой
    _remember(key, data)
    if disk:
        try:
            disk.write_bytes(data)
        except OSError:
            pass
    return data


def clear_api_cache() -> None:
    _api_cache.clear()
    for f in API_DISK.glob("*.json"):
        f.unlink(missing_ok=True)


def drop_cached(key: str) -> None:
    _api_cache.pop(key, None)
    if DISK_CACHED.match(key):
        _disk_file(key).unlink(missing_ok=True)



def reviews_page(anime_id: int, opinion: str = "", page: int = 1) -> dict:
    """Страница отзывов тайтла с shikimori.io, разобранная в словарь (см. reviews.py)."""
    path = reviews.page_url(anime_id, opinion, page)

    def fetch() -> bytes:
        req = urllib.request.Request(SHIKI + path, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
        try:
            page_html = shiki_net.open_url(req)[1].decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code != 404:  # у тайтла нет отзывов — Shikimori может отдать 404
                raise
            page_html = ""
        return json.dumps(reviews.parse(page_html), ensure_ascii=False).encode()
    return json.loads(cached_api("reviews:" + path, fetch))


def shiki_text(path: str, background: bool = False) -> str:
    """Страница (или JSON) с shikimori.io как текст — с общей паузой между запросами."""
    req = urllib.request.Request(SHIKI + path, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})  # с application/json сайт отдаёт страницы JSON-ом
    return shiki_net.open_url(req, 30, background)[1].decode("utf-8", "replace")


# ---- коллекции Shikimori (см. shiki_colls.py) ----
_colls_index = None
_colls_lock = threading.Lock()


def colls_index():
    """Индекс коллекций; при первом обращении (и потом раз в сутки) запускает фоновый обход."""
    global _colls_index
    if _colls_index is None:
        _colls_index = shiki_colls.Index(DATA_DIR / "colls_index.json", lambda p: shiki_text(p, background=True))
    idx = _colls_index
    with _colls_lock:
        st = idx.status()
        if not lite_mode() and not idx.busy and (time.time() - idx.data.get("listed_at", 0) > 24 * 3600 or st["done"] < st["total"]):
            idx.busy = True
            threading.Thread(target=idx.crawl, daemon=True).start()
    return idx


def colls_search(q: dict) -> dict:
    text = (q.get("q", [""])[0] or "").strip()[:100]
    sort = q.get("sort", ["new"])[0]
    anime = q.get("anime", ["1"])[0] == "1"
    page = max(1, int(q.get("page", ["1"])[0] or 1)) if (q.get("page", ["1"])[0] or "1").isdigit() else 1
    idx = colls_index()
    if idx.data.get("listed_at"):  # список собран целиком — ищем по индексу
        return {**idx.search(text, anime, sort, page), "index": idx.status()}
    # индекс ещё не собран — живой Shikimori: поиск по названию или новые коллекции
    if text:
        path = ("/collections.json" if page == 1 else f"/collections/p-{page}.json") + "?search=" + urllib.parse.quote(text)
        items = shiki_colls.parse_previews(json.loads(shiki_text(path)).get("content", ""))
        done = len(items) < 4
    else:
        rows = json.loads(shiki_text(f"/api/topics?forum=collections&limit=30&page={page}") or "[]")
        items, done = [shiki_colls.from_topic(t) for t in rows], len(rows) < 30
    if anime:
        items = [x for x in items if not x["preview"] or any(e["kind"] == "anime" for e in x["preview"])]
    return {"items": items, "done": done, "index": idx.status()}


def coll_detail(cid: int) -> dict:
    d = json.loads(cached_api(f"coll:{cid}", lambda: json.dumps(
        shiki_colls.parse_detail(shiki_text(f"/collections/{cid}")), ensure_ascii=False).encode()))
    colls_index().put(d, True)
    return d


def user_colls(nick: str) -> dict:
    """Коллекции пользователя Shikimori: опубликованные и соавторские (черновики чужим не видны)."""
    base = "/" + urllib.parse.quote(nick) + "/collections"
    out = {}
    for state in ("", "coauthored"):
        items = []
        for page in range(1, 11):
            path = (base if page == 1 else f"{base}/page/{page}") + ("?format=json" if page > 1 else "") + \
                (("&" if page > 1 else "?") + "state=" + state if state else "")
            raw = shiki_text(path)
            if page > 1:
                raw = json.loads(raw).get("content", "")
            got = shiki_colls.parse_previews(raw)
            items += got
            if not got or "b-postloader" not in raw:
                break
        out[state or "published"] = items
    return out
