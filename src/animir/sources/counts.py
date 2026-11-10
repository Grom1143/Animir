"""Сколько тайтлов у каждой озвучки: фоновый подсчёт с сохранением на диск."""

import json
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import animir.shikimori.net as shiki_net
from animir.config import DATA_DIR
from animir.state import lite_mode
from .net import USER_AGENT
from .kodik import kodik_token
from .search import _shiki_candidates


# ================= Сколько тайтлов у каждой озвучки =================
# Полного «количества тайтлов у студии» ни один источник не отдаёт, поэтому
# считаем сами: сканируем топ-300 популярных тайтлов Shikimori (6 страниц по 50),
# одним запросом Kodik получаем ВСЕ озвучки каждого - и суммируем по студиям.
# Результат кэшируется на диск (APPDATA/Анимир/dubs_counts.json), чтобы старт
# не ждал повторного скана.

_counts_path = DATA_DIR / "dubs_counts.json"
_counts_lock = threading.Lock()
_counts: dict[str, int] = {}
_labels: dict[str, int] = {}  # то же, но по названию студии: на него опирается порядок озвучек у тайтла
_counts_sample = 0
_scanning = False


def _norm_label(label: str) -> str:
    """Название студии в сравнимом виде: «AniDUB Online 18+» -> «anidubonline18»."""
    return "".join(ch for ch in (label or "").lower().replace("ё", "е") if ch.isalnum())


def _counts_load() -> None:
    global _counts_sample
    try:
        data = json.loads(_counts_path.read_text("utf-8"))
        with _counts_lock:
            _counts.update(data.get("counts") or {})
            _labels.update(data.get("labels") or {})
            _counts_sample = int(data.get("sample") or 0)
    except Exception:
        pass


def _counts_save() -> None:
    try:
        _counts_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = _counts_path.with_suffix(".tmp")
        with _counts_lock:
            payload = {"counts": dict(_counts), "labels": dict(_labels), "sample": _counts_sample}
        tmp.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
        tmp.replace(_counts_path)
    except Exception:
        pass


def _kdk_all_trs(sid: str) -> list[tuple[str, str]]:
    """(ID озвучки, её название) для тайтла в Kodik (без общего троттлинга - как в _kdk_probe)."""
    body = urllib.parse.urlencode({
        "token": kodik_token(), "shikimori_id": sid, "limit": 100,
    }).encode()
    req = urllib.request.Request(
        "https://kodik-api.com/search", data=body,
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"})
    try:
        data = json.loads(shiki_net.urlopen_pooled(req, 15, idempotent=True)[1].decode("utf-8", "replace"))
        return [(str(tr.get("id")), str(tr.get("title") or ""))
                for e in data.get("results", [])
                if str(e.get("type", "")).startswith(("anime", "cartoon", "foreign"))
                for tr in [(e.get("translation") or {})]]
    except Exception:  # noqa: BLE001 - пропуск тайтла не рушит скан
        return []


def dubs_counts() -> dict[str, int]:
    """{id озвучки: сколько из топ-300 тайтлов ею озвучено}, плюс ключ «_sample».
    Первый вызов запускает скан в фоне (медленно, ~минуту), до готовности
    возвращаются счётчики с прошлого запуска (если есть файл) или пустые."""
    global _scanning
    if _scanning:  # скан уже идёт
        return {**_counts, "_sample": _counts_sample}
    if not (_counts and _labels):
        _counts_load()
    if _counts and _labels:  # готово: есть и счётчики, и названия студий
        return {**_counts, "_sample": _counts_sample}
    if lite_mode():  # на слабом ПК не сканируем 300 тайтлов в фоне
        return {**_counts, "_sample": _counts_sample}
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
            labels: dict[str, int] = {}
            with ThreadPoolExecutor(max_workers=10) as ex:
                for trs in ex.map(_kdk_all_trs, sids):
                    for tid, title in trs:
                        counts[tid] = counts.get(tid, 0) + 1
                        key = _norm_label(title)
                        if key:
                            labels[key] = labels.get(key, 0) + 1
            with _counts_lock:
                _counts.clear()
                _counts.update(counts)
                _labels.clear()
                _labels.update(labels)
                _counts_sample = len(sids)
            _counts_save()
        finally:
            _scanning = False

    threading.Thread(target=scan, daemon=True).start()
    return {**_counts, "_sample": _counts_sample}


def dubs_labels() -> dict:
    """{название студии: сколько из топ-300 тайтлов она озвучила} плюс «_sample».

    Названия приводятся к сравнимому виду (см. _norm_label). Нужно, чтобы у тайтла
    озвучки шли по популярности: сколько тайтлов студия озвучила - насколько она заметна.
    Готового файла нет - запускает тот же фоновой скан, что и dubs_counts."""
    dubs_counts()  # заодно заполнит _labels (или запустит скан)
    with _counts_lock:
        return {"labels": dict(_labels), "sample": _counts_sample}


def pop_of(label: str) -> int:
    """Сколько популярных тайтлов озвучила эта студия.

    У источников названия пишутся по-разному: «AniDUB» у Anixart, «AniDUB Online 18+» у Kodik,
    «AniMedia · Sibnet» (студия и сервер). Поэтому сравниваем по началу названия."""
    dubs_counts()  # заполнит _labels (или запустит скан в фоне)
    n = _norm_label((label or "").split(" · ")[0])
    if not n:
        return 0
    with _counts_lock:
        if n in _labels:
            return _labels[n]
        best = 0
        for key, cnt in _labels.items():
            if len(key) >= 4 and (n.startswith(key) or key.startswith(n)) and cnt > best:
                best = cnt
        return best


def dubs_counts_bg() -> None:
    """Прогрев счётчиков: запускается с сервером, чтобы к первому запросу
    подсчёт уже был готов."""
    dubs_counts()
