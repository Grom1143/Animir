"""Kodik: токен, озвучки по Shikimori-ID и прямая ссылка из кода плеера."""

import base64
import json
import os
import re
import sys
import threading
import time

from .net import SourceError, _get, _post_form, cached
from .shiki import _part_chain


# ================= Kodik =================
_KDK_TOKENS_URLS = (
    "https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/refs/heads/main/kdk_tokns/tokens.json",
    # зеркало на случай, когда github.com не открывается (бывает с VPN и без)
    "https://cdn.jsdelivr.net/gh/YaNesyTortiK/AnimeParsers@main/kdk_tokns/tokens.json",
)
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
            raw = {}
            for url in _KDK_TOKENS_URLS:  # github, потом зеркало: один адрес может не открываться
                try:
                    raw = json.loads(_get(url, tries=1, timeout=15))
                    if raw.get("stable") or raw.get("unstable"):
                        break
                except Exception:
                    continue
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
    """Все записи Kodik по Shikimori-ID: каждая запись - своя озвучка."""
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
    """Озвучки Kodik; если части тайтла «Part N» лежат одной общей записью -
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
    отправить запрос - получить прямую ссылку."""
    dbg = os.environ.get("ANIMIR_DEBUG")
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
                # иногда в src базовый путь CDN - дописываем имя файла этого качества
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


