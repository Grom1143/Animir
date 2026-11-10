"""Сведения из Shikimori для поиска в источниках: названия тайтла и цепочка частей франшизы."""

import json
import os
import re
import traceback
import urllib.parse

from .net import SHIKI, _http, cached


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
        base_en, part = m.group(1).strip().rstrip(" ---"), int(m.group(2))
        if part <= 1 or not base_en:
            return None

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
        # смещение: сумма серий предыдущих частей (часть 1 - базовая запись)
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
        if os.environ.get("ANIMIR_DEBUG"):
            traceback.print_exc()
        return None


def _shikimori_titles(sid: str) -> dict:
    raw = json.loads(_http(SHIKI + f"/api/animes/{urllib.parse.quote(sid)}", tries=2).decode("utf-8", "replace"))
    return {"ru": (raw.get("russian") or ""), "en": (raw.get("name") or "")}
