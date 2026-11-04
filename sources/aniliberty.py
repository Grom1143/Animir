"""AniLiberty (AniLiberty API V1): поиск релиза по названиям и серии с качествами."""

import json
import urllib.parse
import urllib.request

from .net import _http, cached
from .shiki import _part_chain, _shikimori_titles


# ================= AniLiberty (AniLiberty API V1) =================
# основной хост AniLiberty; docs: https://anilibria.top/api/docs/v1
AL = "https://anilibria.top/api/v1"


def _al_release(rid: int | str) -> dict:
    raw = json.loads(_http(f"{AL}/anime/releases/{rid}", tries=2).decode("utf-8", "replace"))
    return raw.get("data") or raw or {}


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


