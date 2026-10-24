"""Animax — внешние источники онлайн-серий (Anixart, AniLiberty, Kodik).

Каждый источник описывается одинаково: список «озвучек» (dubs) по Shikimori-ID
и разрешение конкретной серии в ссылку на видео или embed-плеер.

  online_dubs(shikimori_id)  -> {"dubs": [{key, src, label, type, count}], "errors": []}
  online_stream(id, dub_key, ep) -> {"url", "mode", "site", "count"}

Схема повторяет подход Anixart: серверная часть тянет каталог у источников,
пользователь выбирает озвучку и серию. Прямые ссылки достаются «алгоритмом»
из кода плеера источника и кэшируются; если плеер поменялся и алгоритм
сломался — откат на встроенный плеер источника (embed), как делает Anixart.
"""

import base64
import json
import os
import re
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from config import DATA_DIR
from state import lite_mode

USER_AGENT = "Animax desktop (personal use)"
SHIKI = "https://shikimori.io"

# Вежливая пауза между запросами — своя у каждого сайта: раньше она была общей, и Kodik с AniLiberty
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
            with urllib.request.urlopen(req, timeout=timeout) as r:
                result = r.read()
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
    except Exception:  # noqa: BLE001 — одна недоступная озвучка не повод терять остальные
        return default


# ================= AniLiberty (AniLiberty API V1) =================
# основной хост AniLiberty; docs: https://anilibria.top/api/docs/v1
AL = "https://anilibria.top/api/v1"


def _al_release(rid: int | str) -> dict:
    raw = json.loads(_http(f"{AL}/anime/releases/{rid}", tries=2).decode("utf-8", "replace"))
    return raw.get("data") or raw or {}


def _shikimori_titles(sid: str) -> dict:
    raw = json.loads(_http(SHIKI + f"/api/animes/{urllib.parse.quote(sid)}", tries=2).decode("utf-8", "replace"))
    return {"ru": (raw.get("russian") or ""), "en": (raw.get("name") or "")}


def _al_search(query: str) -> list:
    raw = _http(AL + "/app/search/releases?query=" + urllib.parse.quote(query), tries=2)
    return json.loads(raw.decode("utf-8", "replace"))


def _al_eps(rid: int) -> dict[str, str]:
    """Номер серии -> лучшая доступная m3u8-ссылка."""
    rel = cached(f"al:rel:{rid}", 1800, lambda: _al_release(rid))
    eps: dict[str, str] = {}
    for ep in rel.get("episodes") or []:
        n = str(ep.get("ordinal") or "") or str(ep.get("sort_order") or "")
        url = ep.get("hls_1080") or ep.get("hls_720") or ep.get("hls_480")
        if n.isdigit() and url:
            eps[n] = url if url.startswith("http") else "https://" + url.lstrip("/:")
    return eps


def _al_eps_quals(rid: int, n: int) -> list[dict]:
    """Все качества AniLiberty для конкретной серии (для выбора в плеере)."""
    rel = cached(f"al:rel:{rid}", 1800, lambda: _al_release(rid))
    for ep in rel.get("episodes") or []:
        if str(ep.get("ordinal") or "") == str(n):
            out = []
            for q, key in ((1080, "hls_1080"), (720, "hls_720"), (480, "hls_480")):
                url = ep.get(key)
                if url:
                    out.append({"q": q, "url": url if url.startswith("http")
                                else "https://" + url.lstrip("/:")})
            return sorted(out, key=lambda x: -x["q"])
    return []


def _find_aniliberty(names: dict, sid: str) -> list[tuple[int, str]]:
    """Связка с точностью до Shikimori-ID: AniLiberty указывает shikimori.id в ответе."""
    matches: list[tuple[int, str]] = []
    for query in (names["ru"], names["en"], names["en"].split(":")[0]):
        if not query:
            continue
        try:
            items = cached(f"al:q:{urllib.parse.quote(query)}", 1800, lambda q=query: _al_search(q))
        except Exception:
            continue
        for it in items or []:
            sh = it.get("shikimori") or {}
            if str(sh.get("id") or "") == str(sid):
                rid, name = it["id"], (it.get("name") or {}).get("main", "")
                if not any(r == rid for r, _ in matches):
                    matches.append((rid, name))
        if matches:
            break
    return matches


def _aniliberty_dubs(sid: str) -> list[dict]:
    names = cached(f"title:{sid}", 1800, lambda: _shikimori_titles(sid))
    found = cached(f"al:find:{sid}", 1800, lambda: _find_aniliberty(names, sid))
    chain = None
    if not found:  # «Part N»: ищем релиз базовой части
        chain = cached(f"pt:chain:{sid}", 1800, lambda: _part_chain(sid))
        if chain:
            bnames = cached(f"title:{chain[0]}", 1800, lambda: _shikimori_titles(chain[0]))
            found = _find_aniliberty(bnames, chain[0])
    if not found:
        return []
    offset = int(chain[1]) if chain else 0
    dubs = []
    for rid, name in found:
        eps = cached(f"al:eps:{rid}", 1800, lambda rid=rid: _al_eps(rid))
        if not eps:
            continue
        total = max(int(n) for n in eps)
        if offset and total - offset <= 0:
            continue
        dubs.append({
            "key": f"al:{rid}" + (f":{offset}" if offset else ""),
            "src": "AniLiberty",
            "label": "AniLiberty",
            "type": "voice",
            "count": min(int(chain[2]), total - offset) if offset else total,
        })
    return dubs


# ================= Kodik =================
_KDK_TOKENS_URL = ("https://raw.githubusercontent.com/YaNesyTortiK/"
                   "AnimeParsers/refs/heads/main/kdk_tokns/tokens.json")
_KDK_LEGACY_URL = "https://kodik-add.com/add-players.min.js?v=2"

_token_lock = threading.Lock()
_token: str = ""
_token_ok_at = 0.0


def _kdk_api(endpoint: str, fields: dict) -> dict:
    return _post_form(f"https://kodik-api.com/{endpoint}", fields)


def _try_token(candidate: str) -> bool:
    try:
        _kdk_api("search", {"token": candidate, "title": "Кулинарные скитания", "limit": 1})
        return True
    except Exception:
        return False


def _decode_public_token(token: str) -> str:
    halves = [token[: len(token) // 2][::-1], token[len(token) // 2:][::-1]]
    parts = [base64.b64decode(h.encode()).decode("utf-8", "replace") for h in halves if h]
    return "".join(reversed(parts))


def kodik_token() -> str:
    """Рабочий API-токен Kodik: публичный список -> legacy-скрипт -> (свой ключ)."""
    global _token, _token_ok_at
    with _token_lock:
        if _token and time.time() - _token_ok_at < 6 * 3600:
            return _token
        try:
            raw = json.loads(_get(_KDK_TOKENS_URL, tries=1, timeout=15))
        except Exception:
            raw = {}
        ids = [t.get("tokn", "") for t in raw.get("stable", [])] + \
              [t.get("tokn", "") for t in raw.get("unstable", [])]
        for enc in ids:
            if not enc:
                continue
            candidate = _decode_public_token(enc)
            if candidate and _try_token(candidate):
                _token, _token_ok_at = candidate, time.time()
                return candidate
        legacy = re.search(r'token=([A-Za-z0-9_-]{20,})', _get(_KDK_LEGACY_URL, tries=1))
        if legacy and _try_token(legacy.group(1)):
            _token, _token_ok_at = legacy.group(1), time.time()
            return legacy.group(1)
        raise SourceError("Kodik: не найден рабочий API-токен")


def _kdk_entries(sid: str) -> list[dict]:
    """Все записи Kodik по Shikimori-ID: каждая запись — своя озвучка."""
    def fetch():
        data = _kdk_api("search", {"token": kodik_token(), "shikimori_id": sid,
                                   "with_episodes": "true", "limit": 100})
        if data.get("error") == "Отсутствует или неверный токен":
            data = _kdk_api("search", {"token": kodik_token(), "shikimori_id": sid,
                                       "with_episodes": "true", "limit": 100})
        if data.get("error"):
            raise SourceError(f"Kodik: {data['error']}")
        entries = [r for r in data.get("results", []) if str(r.get("type", "")).startswith(
            ("anime", "cartoon", "foreign-serial", "foreign-cartoon"))]
        if not entries:
            raise SourceError("Kodik: ничего не найдено")
        return entries
    return cached(f"kdk:find:{sid}", 600, fetch)


def _kdk_eps_map(entry: dict) -> dict[str, str]:
    """Сезоны записи -> нумерация 1,2,3… (внутри одного Shikimori-ID чаще один сезон)."""
    eps: dict[str, str] = {}
    seasons = entry.get("seasons") or {}
    ep_links: list[str] = []
    for season in sorted(seasons, key=lambda s: int(re.sub(r"\D", "", s) or 0)):
        block = (seasons.get(season) or {}).get("episodes") or {}
        for num in sorted(block, key=lambda i: int(re.sub(r"\D", "", i) or 0)):
            val = block.get(num)
            link = str(val) if isinstance(val, str) else str(((val or {}).get("link")) or "")
            if link:
                ep_links.append(link if link.startswith("http") else "https:" + link)
    if not ep_links and entry.get("link"):
        ep_links = [entry["link"] if entry["link"].startswith("http") else "https:" + entry["link"]]
    for i, link in enumerate(ep_links, 1):
        eps[str(i)] = link
    return eps


def _kodik_dubs(sid: str) -> list[dict]:
    """Озвучки Kodik; если части тайтла «Part N» лежат одной общей записью —
    находим базовую часть и отдаём серии с правильным смещением."""
    chain = None
    try:
        entries = _kdk_entries(sid)
    except Exception as e:
        entries = []
        if not isinstance(e, SourceError) or "ничего не найдено" not in str(e):
            raise
        chain = cached(f"pt:chain:{sid}", 1800, lambda: _part_chain(sid))
        if not chain:
            raise
        base_sid, offset, our = chain
        entries = _kdk_entries(base_sid)
    dubs = []
    for entry in entries:
        tr = entry.get("translation") or {}
        mid = entry.get("id", "")
        eps = cached(f"kdk:eps:{mid}:{tr.get('id')}", 600, lambda en=entry: _kdk_eps_map(en))
        if not eps:
            continue
        total = max(int(n) for n in eps)
        offset = 0
        if chain:
            base_sid, offset, our = chain
            # у базовой записи серий должно хватать на нашу часть
            if total - offset <= 0:
                continue
            key = f"kdk:{mid}:{tr.get('id')}:{offset}"
            dubs.append({
                "key": key,
                "src": "Kodik",
                "label": tr.get("title") or "?",
                "type": tr.get("type") or "voice",
                "count": min(our, total - offset),
            })
        else:
            dubs.append({
                "key": f"kdk:{mid}:{tr.get('id')}",
                "src": "Kodik",
                "label": tr.get("title") or "?",
                "type": tr.get("type") or "voice",
                "count": total,
            })
    return dubs


# ---------- извлечение прямой ссылки из плеера Kodik ----------
def _caesar_b64decode(string: str) -> str:
    """Ссылки в ответах Kodik закодированы: сдвиг алфавита + base64."""
    for rot in range(26):
        out = []
        for ch in string:
            if ch.isalpha():
                abc = ord('a') if ch.islower() else ord('A')
                out.append(chr((ord(ch) - abc + rot) % 26 + abc))
            else:
                out.append(ch)
        text = "".join(out)
        text += "=" * ((4 - len(text) % 4) % 4)
        try:
            decoded = base64.b64decode(text).decode("utf-8")
            if "mp4:hls:manifest" in decoded or "kodik" in decoded:
                return decoded
        except Exception:
            continue
    return ""


def _kdk_extract(embed_url: str) -> dict | None:
    """«Алгоритм Anixart»: открыть код плеера, взять параметры, подставить,
    отправить запрос — получить прямую ссылку."""
    dbg = os.environ.get("ANIMAX_DEBUG")
    if dbg:
        print("kdk:extract", embed_url, file=sys.stderr)
    try:
        html = _get(embed_url, tries=2)
        m = re.search(r"urlParams\s*=\s*(['\"])?(\{.*?\})\1?\s*;", html)
        if not m:
            if dbg:
                print("kdk:no urlParams", file=sys.stderr)
            return None
        url_params = json.loads(m.group(2))
        bits = re.search(r"\.type\s*=\s*'([^']+)'[\s\S]*?\.hash\s*=\s*'([^']+)'[\s\S]*?\.id\s*=\s*'([^']+)'", html)
        if not bits:
            if dbg:
                print("kdk:no bits", file=sys.stderr)
            return None
        kind, vhash, vid = bits.group(1), bits.group(2), bits.group(3)
        sm = re.search(r'<script[^>]+src="(/[^"]+\.js[^"]*)"', html)
        post = ""
        if sm:
            js = _get("https://kodikplayer.com" + sm.group(1), tries=1)
            # адрес запроса зашифрован: url:atob("btoa-строка") -> путь вида /ftor
            pm = re.search(r'ajax\(\{type:"POST",url:atob\("([A-Za-z0-9+/=]+)"\)', js)
            if not pm:
                pm = re.search(r'url:atob\("([A-Za-z0-9+/=]+)"\)', js)
            if pm:
                try:
                    post = base64.b64decode(pm.group(1)).decode("utf-8", "replace").strip()
                except Exception:
                    post = ""
        if not post:
            if dbg:
                print("kdk:no post", file=sys.stderr)
            return None
        answer = _post_form("https://kodikplayer.com" + post, {
            "hash": vhash, "id": vid, "type": kind,
            "d": url_params.get("d", ""), "d_sign": url_params.get("d_sign", ""),
            "pd": url_params.get("pd", ""), "pd_sign": url_params.get("pd_sign", ""),
            "ref": "", "ref_sign": url_params.get("ref_sign", ""),
            "bad_user": "true", "cdn_is_working": "true",
        })
        if answer.get("error"):
            if dbg:
                print("kdk:answer error", answer.get("error"), file=sys.stderr)
            return None
        quals: dict[int, str] = {}
        best: tuple[int, str] | None = None
        for quality, variants in (answer.get("links") or {}).items():
            try:
                q = int(quality)
            except ValueError:
                continue
            for var in variants or []:
                raw = var.get("src", "")
                if not raw:
                    continue
                if raw.startswith("http"):
                    real = raw
                elif ".m3u8" in raw and raw.startswith("//"):
                    real = "https:" + raw
                else:
                    real = _caesar_b64decode(raw)  # сдвиг-шифр + base64
                if not real:
                    continue
                # иногда в src базовый путь CDN — дописываем имя файла этого качества
                if ".m3u8" not in real and not real.endswith(".mp4"):
                    base = real if real.endswith("/") else real.rsplit("/", 1)[0].rstrip("/") + "/"
                    real = base + f"{q}.mp4"
                if q not in quals:
                    quals[q] = real
                if best is None or q > best[0]:
                    best = (q, real)
        if not best:
            if dbg:
                print("kdk:no best, quals:", list(quals), file=sys.stderr)
            return None
        quality, url = best
        out = {"url": url, "mode": "direct", "quality": quality}
        if len(quals) > 1:
            out["qualities"] = [{"q": q, "url": quals[q]} for q in sorted(quals, reverse=True)]
        return out
    except Exception:
        if dbg:
            import traceback
            traceback.print_exc(file=sys.stderr)
        return None


# ================= Anixart (открытый API каталога Anixart) =================
# Тот же каталог, что использует приложение Anixart: /search/releases {POST},
# /episode/{rel} -> озвучки (types), /episode/{rel}/{type} -> источники,
# /episode/{rel}/{type}/{source} -> серии с ссылками (Kodik/Sibnet/Libria/Sovet…).
ANIX = "https://api.anixart.app"
_ANIX_BAD_TYPE = "не работает"


def _anix_json(path: str, body: dict | None = None) -> dict:
    if body is None:
        raw = _get(ANIX + path, tries=2, timeout=25)
    else:
        raw = _http(ANIX + path, "POST", json.dumps(body, ensure_ascii=False).encode("utf-8"),
                    "application/json", tries=2, timeout=25).decode("utf-8", "replace")
    return json.loads(raw)


_norm_re = re.compile(r"[^0-9a-zа-яё]+")


def _norm_title(s: str) -> str:
    return _norm_re.sub("", (s or "").lower().replace("ё", "е"))


def _part_chain(sid: str) -> tuple[str, int, int] | None:
    """«Фафнир: The Beyond Part 2» и подобные: тайтл разбит на Shikimori-части,
    а на Kodik/Anixart вся серия лежит одной записью первой части.

    Возвращает (sid_базы, смещение_серий, число_серий_нашей_части):
    серия n нашей части = серия (n + смещение) базовой записи. Часть 2 «По ту сторону»
    (Shikimori 40109) → база 34649, смещение 3, своих серий 3."""
    try:
        names = _shikimori_titles(sid)
        m = re.search(r"(.*?)\s+Part\s+(\d+)$", names["en"] or "", re.I)
        if not m:
            return None
        base_en, part = m.group(1).strip().rstrip(" -—–"), int(m.group(2))
        if part <= 1 or not base_en:
            return None
        base_ru = re.sub(r"\s*\d+$", "", names["ru"] or "").strip()

        def shiki_search(q: str) -> list:
            raw = _http(SHIKI + "/api/animes?search=" + urllib.parse.quote(q) + "&limit=20", tries=2)
            return json.loads(raw.decode("utf-8", "replace"))

        def shiki_anime(i: str) -> dict:
            raw = _http(SHIKI + "/api/animes/" + urllib.parse.quote(i), tries=2)
            return json.loads(raw.decode("utf-8", "replace"))

        def look(q: str) -> str:
            """Shikimori-ID записи, чьё нормализованное название совпало."""
            items = cached(f"pt:q:{q}", 1800, lambda qq=q: shiki_search(qq))
            tgt = _norm_title(q)
            for it in items or []:
                for key in ("name", "russian"):
                    if _norm_title(it.get(key)) == tgt:
                        return str(it["id"])
            for it in items or []:  # ослабляем: вхождение в начало
                if _norm_title((it.get("name") or "")).startswith(tgt):
                    return str(it["id"])
            return ""

        def count_of(i: str) -> int:
            a = shiki_anime(i)
            return int(a.get("episodes") or a.get("episodesAired") or 0)

        base_sid = cached(f"pt:base:{sid}", 1800, lambda: look(base_en))
        if not base_sid:
            return None
        # смещение: сумма серий предыдущих частей (часть 1 — базовая запись)
        parts = [(base_sid, cached(f"pt:c:{base_sid}", 1800, lambda: count_of(base_sid)))]
        for i in range(2, part):
            q = f"{base_en} Part {i}"
            psi = cached(f"pt:p:{base_sid}:{i}", 1800, lambda qq=q: look(qq))
            if not psi:
                return None
            parts.append((psi, cached(f"pt:c:{psi}", 1800, lambda p=psi: count_of(p))))
        offset = sum(c for _, c in parts)
        our = cached(f"pt:our:{sid}", 1800, lambda: count_of(sid))
        return (base_sid, offset, our)
    except Exception:
        if os.environ.get("ANIMAX_DEBUG"):
            traceback.print_exc()
        return None


def _anix_find(names: dict) -> int:
    """Shikimori -> релиз Anixart: сверяем нормализованные названия (ру/оригинал)."""
    ru, en = _norm_title(names["ru"]), _norm_title(names["en"])
    queries = [names["ru"], names["en"]] + [p.strip() for p in names["en"].split(":")[1:]]
    for query in filter(None, queries):
        try:
            items = cached(f"ax:q:{urllib.parse.quote(query)}", 1800,
                           lambda q=query: (_anix_json("/search/releases/0", {"query": q}) or {}).get("content") or [])
        except Exception:
            continue
        for it in items:
            ru_a = _norm_title(it.get("title_ru"))
            orig_a = _norm_title(it.get("title_original"))
            if ru and ru_a == ru:
                return int(it["id"])
            if en and len(en) >= 8 and (orig_a == en or en in orig_a):
                return int(it["id"])
    return 0


def _anix_dubs(sid: str) -> list[dict]:
    names = cached(f"title:{sid}", 1800, lambda: _shikimori_titles(sid))
    found = cached(f"ax:find:{sid}", 1800, lambda: _anix_find(names))
    chain = None
    if not found:  # «Part N»: ищем релиз базовой части
        chain = cached(f"pt:chain:{sid}", 1800, lambda: _part_chain(sid))
        if chain:
            bnames = cached(f"title:{chain[0]}", 1800, lambda: _shikimori_titles(chain[0]))
            found = _anix_find(bnames)
    if not found:
        return []
    rid = found
    offset = int(chain[1]) if chain else 0
    types = cached(f"ax:t:{rid}", 600, lambda: (_anix_json(f"/episode/{rid}").get("types") or []))
    # мёртвые озвучки помечены Anixart'ом сами
    types = [ty for ty in types if _ANIX_BAD_TYPE not in (ty.get("name") or "").lower()]

    def sources_of(tid) -> list:
        return cached(f"ax:s:{rid}:{tid}", 600, lambda: (_anix_json(f"/episode/{rid}/{tid}").get("sources") or []))

    # У популярных тайтлов 30+ озвучек, и на каждую нужен свой запрос: по очереди это 14 секунд.
    # Спрашиваем по 6 сразу (не больше — чтобы не перегружать Anixart). Ошибка одной озвучки не мешает остальным.
    with ThreadPoolExecutor(max_workers=6) as ex:
        fetched = dict(zip([ty["id"] for ty in types], ex.map(lambda ty: _safe(sources_of, ty["id"]), types)))
    dubs: list[dict] = []
    for ty in types:
        tname = (ty.get("name") or "").strip()
        tid = ty["id"]
        srcs = fetched.get(tid) or []
        for src in srcs:
            if not src.get("episodes_count"):
                continue
            total = int(src["episodes_count"])
            if offset and total - offset <= 0:
                continue
            sname = (src.get("name") or "").strip()
            label = tname or ("Субтитры" if ty.get("is_sub") else "Озвучка")
            if len(srcs) > 1 and sname:
                label = f"{label} · {sname}"
            dubs.append({
                "key": f"anx:{rid}:{tid}:{src['id']}" + (f":{offset}" if offset else ""),
                "src": "Anixart",
                "label": label,
                "type": "subtitles" if ty.get("is_sub") else "voice",
                "count": min(int(chain[2]), total - offset) if offset else total,
            })
    return dubs


def _anix_stream(sid: str, rid: str, tid: str, srcid: str, ep: str, count: int,
                 offset: int = 0) -> dict:
    """Серия Anixart -> воспроизводимая ссылка: Kodik открываем «алгоритмом Anixart»,
    Libria резолвим через API AniLiberty, Sibnet/Sovet отдаём встроенным плеером."""
    try:
        want = int(ep) + offset
    except ValueError:
        want = 1 + offset
    def fetch():
        return _anix_json(f"/episode/{rid}/{tid}/{srcid}").get("episodes") or []
    eps = cached(f"ax:eps:{rid}:{tid}:{srcid}", 600, fetch)
    item = next((e for e in eps if int(e.get("position") or 0) == want), None)
    if item is None and eps:
        near = min(eps, key=lambda e: abs(int(e.get("position") or 0) - want))
        if abs(int(near.get("position") or 0) - want) <= 1:
            item = near
    url = (item or {}).get("url") or ""
    if not url:
        raise SourceError("У этой озвучки нет доступной серии")
    host = urllib.parse.urlparse(url).netloc
    if host.endswith(("kodikplayer.com", "kodik.info", "kodik.cc")):
        extracted = cached(f"ax:play:{url}", 900, lambda: _kdk_extract(url))
        if isinstance(extracted, dict) and extracted.get("url"):
            out = {"url": extracted["url"], "mode": "direct", "site": "Kodik",
                   "count": count, "quality": extracted.get("quality")}
            if extracted.get("qualities"):
                out["qualities"] = extracted["qualities"]
            return out
        return {"url": url, "mode": "embed", "site": "Kodik", "count": count}
    m = re.search(r"libria\.fun/public/iframe\.php\?id=(\d+)&ep=(\d+)", url)
    if m:
        lid = m.group(1)
        eps_map = cached(f"al:eps:{lid}", 600, lambda: _al_eps(int(lid)))
        got = eps_map.get(str(want))
        if got:
            return {"url": got, "mode": "direct", "site": "Libria", "count": count}
        raise SourceError("Libria: серия недоступна")
    site = {"video.sibnet.ru": "Sibnet", "sovetromantica.com": "SovetRomantica",
            "my.mail.ru": "Myvi"}.get(host) or host
    return {"url": url, "mode": "embed", "site": site, "count": count}


# ================= публичное API модуля =================
# Одна студия в источниках встречается под разными именами: «AniDUB» / «AniDUB Online»,
# «AniLiberty» / «AniLibria.TV», «SHIZA Project» / «SHIZA Project 18+», «Dream Cast» /
# «DreamCast»… Схлопываем такие записи: на каждый тип (озвучка/сабы) остаётся самая
# полная. Если это прямая запись из API AniLiberty — имя «AniLiberty», если старая
# (Anixart/Kodik) — «AniLibria».
_DUB_QUAL = ("online", "онлайн", "site", "сайт", "studio", "студия", "project", "проект",
             "tv", "тв", "hd", "ru", "old", "старая", "старое",
             "official", "официальный", "channel", "канал", "subtitles", "сабы", "субтитры",
             "plus", "плюс", "kodik", "libria", "cr", "18")


def _dub_compact(label: str) -> str:
    return re.sub(r"[^0-9a-zа-яё]+", "", (label or "").lower().replace("ё", "е"))


def _dub_key(label: str) -> str:
    """«AniDUB Online 18+» → «anidub», «AniLiberty» → «anilibria».

    Хвосты отрезаем только у достаточно длинных имён: «LampStudio» останется
    собой, а «AniLibria.TV Old» станет «anilibria»."""
    s = _dub_compact(label)
    changed = True
    while changed:
        changed = False
        for q in _DUB_QUAL:
            if s.endswith(q) and len(s) - len(q) >= 4:
                s = s[:-len(q)]
                changed = True
                break
    return "anilibria" + s[len("aniliberty"):] if s.startswith("aniliberty") else s


def _dub_merge(dubs: list[dict]) -> list[dict]:
    groups: dict[tuple[str, str], list[tuple[int, dict]]] = {}
    for i, d in enumerate(dubs):
        key = _dub_key(d.get("label"))
        if key != "anilibria" and len(key) < 4:  # пустое/слишком короткое — не группируем
            key = f"#{i}"
        groups.setdefault((key, d.get("type") or ""), []).append((i, d))
    drop: set[int] = set()
    for (key, _), fam in groups.items():
        if len(fam) == 1:
            i, d = fam[0]
            if key == "anilibria":  # даже одна запись должна называться правильно
                d["label"] = "AniLiberty" if d.get("src") == "AniLiberty" else "AniLibria"
            continue
        # имя без лишнего хвоста, если оно есть в этой группе
        if key == "anilibria":
            # самая полная запись; при равенстве серий — прямая из API AniLiberty
            best_i, best = max(fam, key=lambda p: (int(p[1].get("count") or 0),
                                                   p[1].get("src") == "AniLiberty"))
            best["label"] = "AniLiberty" if best.get("src") == "AniLiberty" else "AniLibria"
        else:
            clean = next((d["label"] for _, d in fam if _dub_compact(d["label"]) == key), "")
            best_i, best = max(fam, key=lambda p: (int(p[1].get("count") or 0),
                                                   _dub_compact(p[1].get("label")) == key,
                                                   -len(p[1].get("label") or "")))
            if clean:
                best["label"] = clean
        drop.update(i for i, _ in fam if i != best_i)
    return [d for i, d in enumerate(dubs) if i not in drop]


def online_dubs(sid: str) -> dict:
    """Список озвучек для тайтла по Shikimori-ID."""
    errors: list[str] = []
    dubs: list[dict] = []
    # Источники не зависят друг от друга — спрашиваем их одновременно: время ответа теперь равно
    # самому медленному источнику, а не сумме всех (у популярных тайтлов было 15+ секунд).
    # Порядок результатов прежний (Anixart → AniLiberty → Kodik): от него зависит слияние дублей.
    sources = (_anix_dubs, _aniliberty_dubs, _kodik_dubs)
    with ThreadPoolExecutor(max_workers=len(sources)) as ex:
        futures = [ex.submit(src, sid) for src in sources]
    for src, fut in zip(sources, futures):
        try:
            dubs += fut.result()
        except SourceError as e:
            errors.append(str(e))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{src.__name__}: {e}")
    dubs = _dub_merge(dubs)
    if not dubs and errors:
        return {"dubs": [], "errors": errors}
    return {"dubs": dubs, "errors": []}


def online_stream(sid: str, dub_key: str, ep: str) -> dict:
    """Разрешить выбранную озвучку и серию в ссылку для плеера."""
    dubs = cached("dubs:" + sid, 600, lambda: online_dubs(sid))["dubs"]
    dub = next((d for d in dubs if d["key"] == dub_key), None)
    if not dub:
        raise SourceError(f"Озвучка {dub_key} недоступна для этого тайтла")
    count = int(dub.get("count") or 1)
    ep = str(int(ep)) if str(ep).isdigit() else "1"
    if dub_key.startswith("anx:"):
        segs = dub_key.split(":")
        rid, tid, srcid = segs[1], segs[2], segs[3]
        offset = int(segs[4]) if len(segs) > 4 and segs[4].isdigit() else 0
        return _anix_stream(sid, rid, tid, srcid, ep, count, offset)
    if dub_key.startswith("al:"):
        rest = dub_key.split(":", 1)[1].split(":")
        rid, offset = rest[0], 0
        if len(rest) > 1 and rest[1].isdigit():  # al:{rid}:{offset} — «часть серии»
            offset = int(rest[1])
        want = int(ep) + offset  # серия нашей части = серия базовой записи + смещение
        eps = cached(f"al:eps:{rid}", 1800, lambda: _al_eps(int(rid)))
        url = eps.get(str(want))
        if not url:
            raise SourceError("У этой озвучки нет такой серии")
        quals = _al_eps_quals(int(rid), str(want))
        return {"url": url, "mode": "direct", "site": "AniLiberty", "count": count,
                "quality": quals[0]["q"] if quals else None,
                "qualities": quals if len(quals) > 1 else []}
    if dub_key.startswith("kdk:"):
        rest = dub_key.split(":", 1)[1].split(":")
        mid, tr_id, offset = rest[0], rest[1], 0
        if len(rest) > 2 and rest[2].isdigit():  # kdk:{mid}:{trId}:{offset}
            offset = int(rest[2])
        want = int(ep) + offset
        chain = None
        if offset:
            chain = cached(f"pt:chain:{sid}", 1800, lambda: _part_chain(sid))
            if not chain:
                raise SourceError("Kodik: запись недоступна")
            entries = _kdk_entries(chain[0])  # базовая часть
        else:
            entries = _kdk_entries(sid)
        entry = next((e for e in entries if e["id"] == mid
                      and str((e.get("translation") or {}).get("id")) == str(tr_id)), None)
        if entry is None:
            raise SourceError("Kodik: запись недоступна")
        eps = cached(f"kdk:eps:{mid}:{tr_id}", 600, lambda: _kdk_eps_map(entry))
        embed = eps.get(str(want))
        if not embed:
            near = min(eps, key=lambda n: abs(int(n) - want)) if eps else None
            embed = eps.get(near) if near else None
        if not embed:
            raise SourceError("У этой озвучки нет такой серии")
        extracted = cached(f"kdk:play:{embed}", 900, lambda: _kdk_extract(embed))
        if isinstance(extracted, dict) and extracted.get("url"):
            out = {"url": extracted["url"], "mode": "direct", "site": "Kodik",
                   "count": count, "quality": extracted.get("quality")}
            if extracted.get("qualities"):
                out["qualities"] = extracted["qualities"]
            return out
        return {"url": embed, "mode": "embed", "site": "Kodik", "count": count}
    raise SourceError(f"Неизвестный источник озвучки: {dub_key}")


# ================= Поиск по озвучкам (как «Translations» в Anixart) =================
# Kodik не умеет «все тайтлы озвучки X» одним запросом (search требует якорь), поэтому:
#  1) берём список озвучек из /translations (словарь для выбора),
#  2) каталог тайтла озвучки строим так: кандидаты из Shikimori (поиск по названию
#     или самый популярный топ) → проверяем каждого, есть ли у него эта озвучка.

def dubs_list() -> list[dict]:
    """Все озвучки Kodik: [{id, title, type: voice|subtitles}].

    Список почти статичен — кэш на сутки. Порядок важности (известные студии
    сверху) на клиенте расставляет DUB_RANK."""
    return cached("kdk:translations", 86400,
                  lambda: _kdk_api("translations", {"token": kodik_token()}))


def _shiki_candidates(q: str, limit: int, extra: dict | None = None, page: int = 1) -> list[dict]:
    """Список кандидатов из Shikimori: поиск по названию и/или остальные
    условия фильтра (kind/status/genre/… в формате Shikimori-REST); без q —
    популярные тайтлы."""
    parts = [f"limit={limit}", f"page={page}"]
    for k, v in (extra or {}).items():
        if k in ("kind", "status", "genre", "score", "duration", "rating",
                 "season", "order"):
            parts.append(f"{k}={urllib.parse.quote(str(v))}")
    if q:
        parts.append(f"search={urllib.parse.quote(q)}")
    if not parts[-1].startswith("order") and "order=" not in "&".join(parts):
        parts.append("order=popularity")
    if not extra:
        parts.append("rating=r")  # для витрины не показываем категории 18+
    path = "/api/animes?" + "&".join(parts)
    data = cached(f"shiki:cat:{path}", 1800, lambda: _get(SHIKI + path, tries=2))
    return json.loads(data) or []


def _kdk_probe(sid: str, tid: str) -> dict | None:
    """Есть ли у тайтла эта озвучка (проверка без общего троттлинга —
    kodik-api спокойно держит короткие очереди; запись кэшируем на полчаса)."""
    def run() -> dict | None:
        body = urllib.parse.urlencode({
            "token": kodik_token(), "shikimori_id": sid, "translation_id": tid, "limit": 1,
        }).encode()
        req = urllib.request.Request(
            "https://kodik-api.com/search", data=body,
            headers={"User-Agent": USER_AGENT,
                     "Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            res = (data.get("results") or [])
            return res[0] if res else None
        except Exception:  # noqa: BLE001 — ошибка = «не найдено», каталог работает дальше
            return None
    return cached(f"kdk:probe:{sid}:{tid}", 1800, run)


def dubs_catalog(tid: str, q: str = "", limit: int = 30, extra: dict | None = None,
                 page: int = 1) -> dict:
    """Тайтлы озвучки `tid`: кандидаты Shikimori (поиск по `q` + остальные
    условия фильтра из `extra`), у которых проверено наличие этой озвучки у Kodik."""
    tid = str(tid or "")
    if not tid.isdigit():
        raise SourceError("Неверный ID озвучки")
    cands = _shiki_candidates(q.strip(), limit, extra, page)
    workers = 3 if lite_mode() else 8
    with ThreadPoolExecutor(max_workers=workers) as ex:
        probes = list(ex.map(lambda a: _kdk_probe(str(a.get("id")), tid), cands))
    items = []
    for a, hit in zip(cands, probes):
        if not hit:
            continue
        items.append({
            "id": int(a.get("id") or 0),
            "russian": a.get("russian") or "",
            "name": a.get("name") or "",
            "kind": a.get("kind") or "",
            "score": a.get("score") or 0,
            "status": a.get("status") or "",
            "episodes": a.get("episodes") or 0,
            "episodesAired": a.get("episodes_aired") or 0,
            "airedOn": a.get("aired_on") or "",
            "img": (a.get("image") or {}).get("original") or (a.get("image") or {}).get("preview") or "",
            "kdkId": (hit.get("id") or ""),
        })
    return {"items": items, "candidates": len(cands), "q": q}


# ================= Сколько тайтлов у каждой озвучки =================
# Полного «количества тайтлов у студии» ни один источник не отдаёт, поэтому
# считаем сами: сканируем топ-300 популярных тайтлов Shikimori (6 страниц по 50),
# одним запросом Kodik получаем ВСЕ озвучки каждого — и суммируем по студиям.
# Результат кэшируется на диск (APPDATA/Animax/dubs_counts.json), чтобы старт
# не ждал повторного скана.

_counts_path = DATA_DIR / "dubs_counts.json"
_counts_lock = threading.Lock()
_counts: dict[str, int] = {}
_counts_sample = 0
_scanning = False


def _counts_load() -> None:
    global _counts_sample
    try:
        data = json.loads(_counts_path.read_text("utf-8"))
        with _counts_lock:
            _counts.update(data.get("counts") or {})
            _counts_sample = int(data.get("sample") or 0)
    except Exception:
        pass


def _counts_save() -> None:
    try:
        _counts_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = _counts_path.with_suffix(".tmp")
        with _counts_lock:
            payload = {"counts": dict(_counts), "sample": _counts_sample}
        tmp.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
        tmp.replace(_counts_path)
    except Exception:
        pass


def _kdk_all_trs(sid: str) -> list[str]:
    """Все ID озвучек тайтла в Kodik (без общего троттлинга — как в _kdk_probe)."""
    body = urllib.parse.urlencode({
        "token": kodik_token(), "shikimori_id": sid, "limit": 100,
    }).encode()
    req = urllib.request.Request(
        "https://kodik-api.com/search", data=body,
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        return [str((e.get("translation") or {}).get("id"))
                for e in data.get("results", [])
                if str(e.get("type", "")).startswith(("anime", "cartoon", "foreign"))]
    except Exception:  # noqa: BLE001 — пропуск тайтла не рушит скан
        return []


def dubs_counts() -> dict[str, int]:
    """{id озвучки: сколько из топ-300 тайтлов her озвучено}, плюс ключ «_sample».
    Первый вызов запускает скан в фоне (медленно, ~минуту), до готовности
    возвращаются счётчики с прошлого запуска (если есть файл) или пустые."""
    global _counts_sample, _scanning
    if _counts or _scanning:  # уже готово или скан в процессе
        return {**_counts, "_sample": _counts_sample}
    _counts_load()
    if _counts:
        return {**_counts, "_sample": _counts_sample}
    if lite_mode():  # на слабом ПК не сканируем 300 тайтлов в фоне
        return {"_sample": 0}
    _scanning = True

    def scan() -> None:
        global _counts_sample, _scanning
        try:
            sids: list[str] = []
            for page in (1, 2, 3, 4, 5, 6):
                try:
                    sids += [str(a.get("id") or 0) for a in _shiki_candidates("", 50, None, page)]
                except Exception:
                    pass
            counts: dict[str, int] = {}
            with ThreadPoolExecutor(max_workers=10) as ex:
                for trs in ex.map(_kdk_all_trs, sids):
                    for tr in trs:
                        counts[tr] = counts.get(tr, 0) + 1
            with _counts_lock:
                _counts.clear()
                _counts.update(counts)
                _counts_sample = len(sids)
            _counts_save()
        finally:
            _scanning = False

    threading.Thread(target=scan, daemon=True).start()
    return {"_sample": _counts_sample}


def dubs_counts_bg() -> None:
    """Прогрев счётчиков: запускается с сервером, чтобы к первому запросу
    подсчёт уже был готов."""
    dubs_counts()
