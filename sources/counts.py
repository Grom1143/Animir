"""Сколько тайтлов у каждой озвучки: фоновый подсчёт с сохранением на диск."""

import json
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import shiki_net
from config import DATA_DIR
from state import lite_mode
from .net import USER_AGENT
from .kodik import kodik_token
from .search import _shiki_candidates


# ================= Сколько тайтлов у каждой озвучки =================
# Полного «количества тайтлов у студии» ни один источник не отдаёт, поэтому
# считаем сами: сканируем топ-300 популярных тайтлов Shikimori (6 страниц по 50),
# одним запросом Kodik получаем ВСЕ озвучки каждого — и суммируем по студиям.
# Результат кэшируется на диск (APPDATA/Анимир/dubs_counts.json), чтобы старт
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
        data = json.loads(shiki_net.urlopen_pooled(req, 15, idempotent=True)[1].decode("utf-8", "replace"))
        return [str((e.get("translation") or {}).get("id"))
                for e in data.get("results", [])
                if str(e.get("type", "")).startswith(("anime", "cartoon", "foreign"))]
    except Exception:  # noqa: BLE001 — пропуск тайтла не рушит скан
        return []


def dubs_counts() -> dict[str, int]:
    """{id озвучки: сколько из топ-300 тайтлов ею озвучено}, плюс ключ «_sample».
    Первый вызов запускает скан в фоне (медленно, ~минуту), до готовности
    возвращаются счётчики с прошлого запуска (если есть файл) или пустые."""
    global _scanning
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
