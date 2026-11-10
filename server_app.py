"""Анимир - маршруты самого приложения: окна, переходы, уведомления, состояние, медиатека, кэш."""
import os
import threading
import urllib.parse
from pathlib import Path

import server_online
import sysinfo
import windows
from config import IMG_CACHE, SHIKI
from media import is_allowed_media, pick_folder, scan_library
from server_routes import get, post
from shiki_data import clear_api_cache
from state import lite_mode, read_for, write_from

# Экран, на который должно перейти главное окно (клик по уведомлению Windows → Animir.pyw → сюда).
# Окно спрашивает /api/goto раз в пару секунд и забирает его.
_pending_nav: list[str | None] = [None]


def set_pending_nav(h: str) -> None:
    _pending_nav[0] = h


class AppRoutes:
    # ---------- о приложении ----------
    @get("/api/ping")
    def ping(self, q):
        self.send_json({"app": "Анимир"})

    @get("/api/sys")
    def sys_info(self, q):
        self.send_json({**sysinfo.info(), "lite": lite_mode(), "online": server_online.online is not None})

    @post("/api/quit")
    def quit(self):
        self.send_json({"ok": True})
        threading.Thread(target=windows.quit_app, daemon=True).start()

    # ---------- окна ----------
    @get("/api/goto")
    def goto_take(self, q):
        h, _pending_nav[0] = _pending_nav[0], None
        self.send_json({"hash": h})

    @post("/api/goto")
    def goto_put(self):
        h = str(self.json_body().get("hash") or "")
        if not h.startswith("#/") or len(h) > 300:
            return self.send_json({"error": "bad hash"}, 400)
        set_pending_nav(h)
        self.send_json({"ok": True})

    @post("/api/show")
    def show(self):
        # второй запуск Анимир просит своё окно показаться; ok=False - окна нет, откроется Edge
        self.send_json({"ok": windows.show_main()})

    @post("/api/open-window")
    def open_window(self):
        # открытие просмотра в отдельном окне приложения: {"url": "#/watch?..."}
        frag = (self.json_body().get("url") or "").strip()
        if not frag.startswith("#/watch") or len(frag) > 300 or any(c.isspace() for c in frag):
            return self.send_json({"error": "bad url"}, 400)
        if windows.open_app_window(frag, self.server.server_address[1]):
            return self.send_json({"ok": True})
        self.send_json({"error": "edge not found"}, 500)

    @get("/api/player")
    def player(self, q):
        self.send_json(windows.player_info())

    @post("/api/player/close")
    def player_close(self):
        self.send_json({"ok": windows.close_player()})

    @post("/api/pin-window")
    def pin_window(self):
        # «поверх всех окон» применяется к окну, откуда нажали кнопку (оно сейчас активное)
        on = bool(self.json_body().get("on"))
        hwnd = windows.foreground_window()
        if not hwnd:
            return self.send_json({"error": "no window"}, 400)
        windows.set_topmost(hwnd, on)
        self.send_json({"ok": True})

    @post("/api/open-url")
    def open_url(self):
        # открыть ссылку в обычном браузере Windows - только Shikimori
        url = str(self.json_body().get("url", ""))
        if not url.startswith(SHIKI + "/"):
            return self.send_json({"error": "forbidden"}, 403)
        os.startfile(url)
        self.send_json({"ok": True})

    @post("/api/notify")
    def notify(self):
        # тост-уведомление на рабочем столе: {"title": "...", "body": "...", "href": "#/anime/1", "img": "<постер>"}
        # клик по нему откроет Анимир на экране href (ссылка animir:, её регистрирует Animir.pyw)
        d = self.json_body()
        href = str(d.get("href") or "#/notifications")
        if not href.startswith("#/") or len(href) > 300:
            href = "#/notifications"
        poster = windows.toast_poster(str(d.get("img") or "")[:500])
        ok, err = windows._win_toast(str(d.get("title") or "Анимир")[:80], str(d.get("body") or "")[:220],
                                     "animir:open?h=" + urllib.parse.quote(href, safe=""), poster)
        self.send_json({"ok": True} if ok else {"error": err or "toast failed"}, 200 if ok else 500)

    # ---------- закладки и настройки ----------
    @get("/api/state")
    def state_read(self, q):
        self.send_json(read_for(q.get("win", [""])[0][:40]))

    @post("/api/state")
    def state_write(self):
        state = self.json_body()
        if not isinstance(state, dict):
            return self.send_json({"error": "bad state"}, 400)
        self.send_json(write_from(state))  # сливает изменения разных окон

    # ---------- медиатека ----------
    @get("/api/library")
    def library(self, q):
        self.send_json(scan_library())

    @post("/api/pick-folder")
    def folder_pick(self):
        self.send_json({"path": pick_folder()})

    @post("/api/open-external")
    def open_external(self):
        p = Path(self.json_body().get("path", ""))
        if p.is_file() and is_allowed_media(p):
            os.startfile(p)  # системный плеер (VLC, «Кино и ТВ» и т.п.)
            return self.send_json({"ok": True})
        self.send_json({"error": "not found"}, 404)

    # ---------- кэш ----------
    @get("/api/cache")
    def cache_info(self, q):
        files = [f for f in IMG_CACHE.iterdir() if f.is_file()]
        self.send_json({"files": len(files), "bytes": sum(f.stat().st_size for f in files)})

    @post("/api/cache/clear")
    def cache_clear(self):
        for f in IMG_CACHE.iterdir():
            if f.is_file():
                f.unlink(missing_ok=True)
        clear_api_cache()
        self.send_json({"ok": True})

