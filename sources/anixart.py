"""Anixart (открытый API каталога): поиск тайтла, озвучки и ссылки на серии."""

import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .net import SourceError, _get, _http, _safe, cached
from .aniliberty import _al_eps
from .shiki import _norm_title, _part_chain, _shikimori_titles
from .kodik import _kdk_extract


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


