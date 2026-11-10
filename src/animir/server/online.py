"""Анимир - маршруты онлайн-источников (AniLiberty, Kodik, Anixart): озвучки, серии, поиск по озвучкам."""
import os
import urllib.error
from pathlib import Path

import animir.downloads as downloader
from animir.config import SAFE_VAL
from animir.server.routes import get, post

try:  # онлайн-источники - необязательная часть: в сборке без них Анимир работает как каталог и медиатека
    import animir.sources as online
except ImportError:
    online = None


class OnlineRoutes:
    def no_online(self, code: int = 404) -> bool:
        """В сборке без источников: ответить «нет» и вернуть True - обработчику дальше делать нечего."""
        if online is not None:
            return False
        self.send_json({"dubs": [], "counts": {}, "sample": 0, "error": "Онлайн-источников в этой версии нет"}, code)
        return True

    @get("/api/online")
    def online_dubs(self, q):
        if self.no_online(200):
            return
        sid = q.get("p", [""])[0]
        if not sid.strip().replace("-", "").isdigit():
            return self.send_json({"error": "нужен Shikimori-ID (p=)"}, 400)
        try:
            self.send_json(online.online_dubs(sid))
        except Exception as e:  # noqa: BLE001
            self.send_json({"dubs": [], "errors": [str(e)]})

    @get("/api/online/stream")
    def online_stream(self, q):
        if self.no_online():
            return
        sid, dub, ep = q.get("p", [""])[0], q.get("d", [""])[0], q.get("e", [""])[0]
        if not sid.strip() or not dub:
            return self.send_json({"error": "нужны параметры p=, d=, e="}, 400)
        try:
            # прямые ссылки сторонних CDN отдаём как есть; embed обёрнуты во фронтенде
            self.send_json(online.online_stream(sid, dub, ep))
        except online.SourceError as e:
            self.send_json({"error": str(e)}, 404)
        except Exception as e:  # noqa: BLE001
            self.send_json({"error": str(e)}, 500)

    @get("/api/health")
    def health(self, q):
        # проверка источников: кто отвечает и за сколько (для «ничего не запускается» и VPN)
        if self.no_online():
            return
        try:
            self.send_json(online.health_check())
        except Exception as e:  # noqa: BLE001
            self.send_json({"items": [], "ok": False, "error": str(e)[:200]})

    # ---------- скачивание серий ----------
    @post("/api/download")
    def download_start(self):
        # {"sid": 30276, "dub": "al:10290", "label": "AniLiberty", "title": "Ванпанчмен",
        #  "episodes": [1,2,3]} - очередь на скачивание одной озвучки
        if self.no_online():
            return
        b = self.json_body()
        sid = str(b.get("sid") or "")
        dub, label = str(b.get("dub") or ""), str(b.get("label") or "")
        title = str(b.get("title") or "Анимир")[:120]
        eps = b.get("episodes")
        if not sid.isdigit() or not dub or not isinstance(eps, list) or not eps:
            return self.send_json({"error": "нужны sid, dub и список episodes"}, 400)
        try:
            job = downloader.start(sid, dub, label, title, eps[:500])
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": str(e)[:200]}, 500)
        self.send_json({"job": job, "folder": str(downloader.DOWNLOADS)})

    @get("/api/downloads")
    def downloads(self, q):
        self.send_json({"jobs": downloader.list_jobs(), "folder": str(downloader.DOWNLOADS)})

    @post("/api/downloads/cancel")
    def downloads_cancel(self):
        ok = downloader.cancel(str(self.json_body().get("id") or ""))
        self.send_json({"ok": ok})

    @post("/api/downloads/clear")
    def downloads_clear(self):
        downloader.clear_finished()
        self.send_json({"ok": True})

    @post("/api/downloads/open")
    def downloads_open(self):
        # открыть папку загрузок (или папку конкретного задания) в Проводнике
        job_id = str(self.json_body().get("id") or "")
        folder = next((j.get("folder") for j in downloader.list_jobs() if j["id"] == job_id), "")
        path = folder or str(downloader.DOWNLOADS)
        if not os.path.isdir(path):
            path = str(downloader.DOWNLOADS)
            Path(path).mkdir(parents=True, exist_ok=True)
        os.startfile(path)  # noqa: S606 - открываем только свою папку
        self.send_json({"ok": True})

    @get("/api/dubs")
    def dubs(self, q):
        # словарь всех озвучек Kodik + сколько популярных тайтлов озвучено (counts[_sample] - размер выборки скана)
        if self.no_online():
            return
        counts = online.dubs_counts()
        self.send_json({"dubs": online.dubs_list(), "counts": counts, "sample": counts.get("_sample") or 0})

    @get("/api/dubs/find")
    def dubs_find(self, q):
        # каталог тайтлов озвучки: ?tid=<id>&q=<название>&page=<n> + остальные условия фильтра
        # (kind, status, genre, score, duration, rating, season, order) - как на Shikimori-REST
        if self.no_online():
            return
        extra = {}
        for k in ("kind", "status", "genre", "score", "duration", "rating", "season", "order"):
            v = (q.get(k, [""])[0] or "").strip()
            if v and SAFE_VAL.match(v):
                extra[k] = v
        sq = (q.get("q", [""])[0] or "").strip()[:80]
        page = (q.get("page", [""])[0] or "1").strip()
        try:
            self.send_json(online.dubs_catalog(q.get("tid", [""])[0], sq, limit=50, extra=extra,
                                               page=int(page) if page.isdigit() else 1))
        except online.SourceError as e:
            self.send_json({"error": str(e)}, 400)
        except (urllib.error.URLError, TimeoutError) as e:
            self.send_json({"error": f"Нет связи с источниками: {e}"}, 502)
