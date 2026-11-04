"""Анимир — маршруты онлайн-источников (AniLiberty, Kodik, Anixart): озвучки, серии, поиск по озвучкам."""
import urllib.error

from config import SAFE_VAL
from server_routes import get

try:  # онлайн-источники — необязательная часть: в сборке без них Анимир работает как каталог и медиатека
    import sources as online
except ImportError:
    online = None


class OnlineRoutes:
    def no_online(self, code: int = 404) -> bool:
        """В сборке без источников: ответить «нет» и вернуть True — обработчику дальше делать нечего."""
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

    @get("/api/dubs")
    def dubs(self, q):
        # словарь всех озвучек Kodik + сколько популярных тайтлов озвучено (counts[_sample] — размер выборки скана)
        if self.no_online():
            return
        counts = online.dubs_counts()
        self.send_json({"dubs": online.dubs_list(), "counts": counts, "sample": counts.get("_sample") or 0})

    @get("/api/dubs/find")
    def dubs_find(self, q):
        # каталог тайтлов озвучки: ?tid=<id>&q=<название>&page=<n> + остальные условия фильтра
        # (kind, status, genre, score, duration, rating, season, order) — как на Shikimori-REST
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
