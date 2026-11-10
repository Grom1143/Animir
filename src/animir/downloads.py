"""Анимир - скачивание серий: очередь, прогресс, mp4 и HLS без ffmpeg.

Работает поверх онлайн-источников: для каждой серии берём ту же ссылку, что уходит в плеер.
Прямой mp4 качаем как файл, HLS - сегментами .ts.

Одним файлом: серии HLS дописываются в общий .ts (MPEG-TS это позволяет, плееры понимают
склейку). Если серия пришла прямым mp4, склеить её без перекодирования нельзя - сохраняем
отдельным файлом и пишем об этом в задании.
"""

import os
import re
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

from animir.config import USER_AGENT

DOWNLOADS = Path(os.environ.get("USERPROFILE") or Path.home()) / "Downloads" / "Анимир"

_jobs: list[dict] = []
_lock = threading.Lock()


def _clean(name: str) -> str:
    """Имя файла без запрещённых символов."""
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", name or "").strip(" .")
    return re.sub(r"\s+", " ", s)[:120] or "Серия"


def _abs(url: str) -> str:
    """Ссылки Kodik приходят без схемы (//cdn/...): urllib так не умеет, добавляем https."""
    return "https:" + url if url.startswith("//") else url


def _fetch(url: str, timeout: int = 30, tries: int = 2) -> bytes:
    url = _abs(url)
    last = None
    for _ in range(max(1, tries)):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - повторяем: CDN иногда рвёт соединение
            last = e
            time.sleep(0.4)
    raise last or RuntimeError("не удалось скачать")


def _stream_into(fh, url: str, job: dict, base_done: int) -> None:
    """Прямой файл (mp4): читаем кусками и показываем прогресс по байтам."""
    req = urllib.request.Request(_abs(url), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while True:
            if job.get("cancel"):
                raise Cancel()
            chunk = r.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            got += len(chunk)
            if total:
                _progress(job, base_done + got / total)


def _save_stream(url: str, out: Path, job: dict, base_done: int) -> None:
    with out.open("wb") as f:
        _stream_into(f, url, job, base_done)


def _hls_segments(url: str) -> list[str]:
    url = _abs(url)
    text = _fetch(url, timeout=20).decode("utf-8", "replace")
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    for line in lines:
        if line.startswith("#EXT-X-KEY") and "METHOD=NONE" not in line:
            raise RuntimeError("поток защищён ключом - скачивание не поддерживается")
        if line.startswith("#EXT-X-MAP"):
            raise RuntimeError("поток в формате fMP4 - скачивание пока не поддерживается")
    return [urllib.parse.urljoin(url, x) for x in lines if not x.startswith("#")]


def _hls_into(fh, url: str, job: dict, base_done: int) -> None:
    """Сегменты одного плейлиста дописываем в открытый файл."""
    segs = _hls_segments(url)
    if not segs:
        raise RuntimeError("плейлист пуст")
    for i, seg in enumerate(segs, 1):
        if job.get("cancel"):
            raise Cancel()
        fh.write(_fetch(seg, timeout=30, tries=3))
        _progress(job, base_done + i / len(segs))


def _save_hls(url: str, out: Path, job: dict, base_done: int) -> None:
    with out.open("wb") as f:
        _hls_into(f, url, job, base_done)


class Cancel(Exception):
    pass


def _progress(job: dict, value: float) -> None:
    with _lock:
        job["part"] = round(max(0.0, min(1.0, value)), 3)
        job["percent"] = round((job["done"] + job["part"]) / max(1, job["total"]) * 100, 1)


def _job(id_: str) -> dict | None:
    with _lock:
        return next((j for j in _jobs if j["id"] == id_), None)


def start(sid: str, dub: str, label: str, title: str, episodes: list[int], single: bool = False) -> dict:
    """Поставить в очередь скачивание серий одной озвучки.

    single=True - всё в один файл `.ts` (для HLS). mp4-серии всё равно лягут отдельными файлами."""
    eps = sorted({int(n) for n in episodes if int(n) > 0})
    job = {
        "id": f"dl{int(time.time() * 1000)}",
        "sid": str(sid), "dub": dub, "label": label, "title": title, "single": bool(single),
        "episodes": eps, "total": len(eps), "done": 0, "part": 0.0, "percent": 0.0,
        "state": "running", "error": "", "note": "", "file": "", "at": time.time(), "cancel": False,
    }
    with _lock:
        _jobs.insert(0, job)
        del _jobs[20:]
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return job


def _resolve(job: dict, n: int):
    """Ссылка на серию или (None, причина)."""
    import animir.sources as sources
    from animir.sources import SourceError
    try:
        st = sources.online_stream(job["sid"], job["dub"], str(n))
    except SourceError as e:
        return None, str(e)
    url = str(st.get("url") or "")
    if not url or st.get("mode") == "embed":
        return None, "источник отдаёт только встроенный плеер"
    return url, ""


def _run(job: dict) -> None:
    folder = DOWNLOADS / _clean(job["title"] or "Анимир")
    single = job.get("single")
    try:
        folder.mkdir(parents=True, exist_ok=True)
        if single:
            _run_single(job, folder)
        else:
            _run_episodes(job, folder)
    except Cancel:
        job["state"] = "cancelled"
    except Exception as e:  # noqa: BLE001
        job["state"] = "error"
        job["error"] = str(e)[:200]
    finally:
        job["part"] = 0.0
        job["percent"] = 100.0 if job["state"] == "done" else job["percent"]
        job["folder"] = str(folder)


def _run_episodes(job: dict, folder: Path) -> None:
    for n in job["episodes"]:
        if job.get("cancel"):
            raise Cancel()
        job["ep"] = n
        url, why = _resolve(job, n)
        if not url:
            job["skipped"] = job.get("skipped", 0) + 1
            job["error"] = f"серия {n}: {why}"
            job["done"] += 1
            continue
        hls = ".m3u8" in url.lower()
        ext = ".ts" if hls else ".mp4"
        out = folder / f"{_clean(job['title'])} - {n:02d} [{_clean(job['label'])}]{ext}"
        job["file"] = str(out)
        if out.exists() and out.stat().st_size > 1024 * 1024:
            job["done"] += 1  # уже скачано раньше
            _progress(job, 0)
            continue
        tmp = out.with_suffix(out.suffix + ".part")
        try:
            if hls:
                _save_hls(url, tmp, job, job["done"])
            else:
                _save_stream(url, tmp, job, job["done"])
            tmp.replace(out)
        except Cancel:
            tmp.unlink(missing_ok=True)
            raise
        except Exception as e:  # noqa: BLE001 - одна серия не должна ронять всю очередь
            tmp.unlink(missing_ok=True)
            job["skipped"] = job.get("skipped", 0) + 1
            job["error"] = f"серия {n}: {e}"
        job["done"] += 1
        _progress(job, 0)
    job["state"] = "done" if not job.get("skipped") else "partial"


def _run_single(job: dict, folder: Path) -> None:
    """Весь тайтл одним файлом: серии HLS дописываются в общий .ts."""
    title = f"{_clean(job['title'])} [{_clean(job['label'])}]"
    out = folder / f"{title}.ts"
    job["file"] = str(out)
    if out.exists() and out.stat().st_size > 1024 * 1024:
        job["done"] = job["total"]
        job["state"] = "done"
        return
    tmp = out.with_suffix(".ts.part")
    separate = 0
    mp4_eps = []
    try:
        with tmp.open("wb") as f:
            for n in job["episodes"]:
                if job.get("cancel"):
                    raise Cancel()
                job["ep"] = n
                url, why = _resolve(job, n)
                if not url:
                    job["skipped"] = job.get("skipped", 0) + 1
                    job["error"] = f"серия {n}: {why}"
                    job["done"] += 1
                    continue
                if ".m3u8" in url.lower():
                    try:
                        _hls_into(f, url, job, job["done"])
                    except Cancel:
                        raise
                    except Exception as e:  # noqa: BLE001
                        job["skipped"] = job.get("skipped", 0) + 1
                        job["error"] = f"серия {n}: {e}"
                else:
                    # mp4 в общий поток не склеить без перекодирования - кладём рядом
                    mp4_eps.append(n)
                    ep_out = folder / f"{_clean(job['title'])} - {n:02d} [{_clean(job['label'])}].mp4"
                    try:
                        _save_stream(url, ep_out.with_suffix(".mp4.part"), job, job["done"])
                        ep_out.with_suffix(".mp4.part").replace(ep_out)
                        separate += 1
                    except Cancel:
                        raise
                    except Exception as e:  # noqa: BLE001
                        job["skipped"] = job.get("skipped", 0) + 1
                        job["error"] = f"серия {n}: {e}"
                job["done"] += 1
                _progress(job, 0)
        tmp.replace(out)
    except Cancel:
        tmp.unlink(missing_ok=True)
        raise
    if separate:
        job["note"] = (f"{separate} серий сохранены отдельными mp4: их нельзя склеить без перекодирования")
    job["state"] = "done" if not job.get("skipped") else "partial"


def cancel(job_id: str) -> bool:
    j = _job(job_id)
    if not j or j["state"] != "running":
        return False
    j["cancel"] = True
    return True


def list_jobs() -> list[dict]:
    with _lock:
        return [{k: v for k, v in j.items() if k != "cancel"} for j in _jobs]


def clear_finished() -> None:
    with _lock:
        _jobs[:] = [j for j in _jobs if j["state"] == "running"]
