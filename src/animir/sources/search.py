"""Поиск по озвучкам (как «Translations» в Anixart): какие тайтлы есть у озвучки."""

import json
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import animir.shikimori.net as shiki_net
from animir.state import lite_mode
from .net import SHIKI, SourceError, USER_AGENT, _get, cached
from .kodik import _kdk_api, kodik_token


# ================= Поиск по озвучкам (как «Translations» в Anixart) =================
# Kodik не умеет «все тайтлы озвучки X» одним запросом (search требует якорь), поэтому:
#  1) берём список озвучек из /translations (словарь для выбора),
#  2) каталог тайтла озвучки строим так: кандидаты из Shikimori (поиск по названию
#     или самый популярный топ) → проверяем каждого, есть ли у него эта озвучка.

def dubs_list() -> list[dict]:
    """Все озвучки Kodik: [{id, title, type: voice|subtitles}].

    Список почти статичен - кэш на сутки. Порядок важности (известные студии
    сверху) на клиенте расставляет DUB_RANK."""
    return cached("kdk:translations", 86400,
                  lambda: _kdk_api("translations", {"token": kodik_token()}))


def _shiki_candidates(q: str, limit: int, extra: dict | None = None, page: int = 1) -> list[dict]:
    """Список кандидатов из Shikimori: поиск по названию и/или остальные
    условия фильтра (kind/status/genre/… в формате Shikimori-REST); без q -
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
    """Есть ли у тайтла эта озвучка (проверка без общего троттлинга -
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
            data = json.loads(shiki_net.urlopen_pooled(req, 15, idempotent=True)[1].decode("utf-8", "replace"))
            res = (data.get("results") or [])
            return res[0] if res else None
        except Exception:  # noqa: BLE001 - ошибка = «не найдено», каталог работает дальше
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


