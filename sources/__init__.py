"""Анимир - внешние источники онлайн-серий (Anixart, AniLiberty, Kodik).

Каждый источник описывается одинаково: список «озвучек» (dubs) по Shikimori-ID
и разрешение конкретной серии в ссылку на видео или embed-плеер.

  online_dubs(shikimori_id)  -> {"dubs": [{key, src, label, type, count}], "errors": []}
  online_stream(id, dub_key, ep) -> {"url", "mode", "site", "count"}

Пакет: net - сеть и кэш, aniliberty / kodik / anixart - по файлу на источник, search - поиск по озвучкам,
counts - сколько тайтлов у озвучки. Здесь - слияние озвучек разных источников и всё, что зовёт сервер.

Схема повторяет подход Anixart: серверная часть тянет каталог у источников,
пользователь выбирает озвучку и серию. Прямые ссылки достаются «алгоритмом»
из кода плеера источника и кэшируются; если плеер поменялся и алгоритм
сломался - откат на встроенный плеер источника (embed), как делает Anixart.
"""

import re
from concurrent.futures import ThreadPoolExecutor

from .net import SourceError, cached
from .aniliberty import _al_eps, _al_eps_quals, _aniliberty_dubs
from .kodik import _kdk_entries, _kdk_eps_map, _kdk_extract, _kodik_dubs
from .anixart import _anix_dubs, _anix_stream
from .shiki import _part_chain


# ================= публичное API модуля =================
# Одна студия в источниках встречается под разными именами: «AniDUB» / «AniDUB Online»,
# «AniLiberty» / «AniLibria.TV», «SHIZA Project» / «SHIZA Project 18+», «Dream Cast» /
# «DreamCast»… Схлопываем такие записи: на каждый тип (озвучка/сабы) остаётся самая
# полная. Если это прямая запись из API AniLiberty - имя «AniLiberty», если старая
# (Anixart/Kodik) - «AniLibria».
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
        if key != "anilibria" and len(key) < 4:  # пустое/слишком короткое - не группируем
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
            # самая полная запись; при равенстве серий - прямая из API AniLiberty
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
    # Источники не зависят друг от друга - спрашиваем их одновременно: время ответа теперь равно
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
    # Популярность студии: сколько из топ-300 тайтлов она озвучила (скан в counts.py).
    # Сначала голосовые озвучки, потом субтитры; внутри - самые заметные студии.
    from .counts import pop_of  # локально: counts тянет сеть и нужен только здесь
    for d in dubs:
        d["pop"] = pop_of(d.get("label"))
    dubs.sort(key=lambda d: (d.get("type") == "subtitles", -d["pop"],
                             -int(d.get("count") or 0), d.get("label") or ""))
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
        if len(rest) > 1 and rest[1].isdigit():  # al:{rid}:{offset} - «часть серии»
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


# Остальное, что зовёт сервер (server.py: import sources as online)
from .search import dubs_catalog, dubs_list  # noqa: E402
from .counts import dubs_counts, dubs_counts_bg, dubs_labels, pop_of  # noqa: E402
from .health import health_check  # noqa: E402

__all__ = ["SourceError", "online_dubs", "online_stream", "dubs_list", "dubs_catalog",
           "dubs_counts", "dubs_counts_bg", "dubs_labels", "pop_of", "health_check"]
