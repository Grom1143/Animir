"""Animax — локальный сервер.

Отдаёт интерфейс из папки web/, ходит в API Shikimori (каталог аниме),
кэширует картинки, хранит твои списки и отдаёт видео из твоих папок.
Запускается из Animax.pyw, сам по себе тоже работает: python server.py
"""

import hashlib
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import shiki_auth
import shiki_net
try:  # онлайн-источники — необязательная часть: в сборке Animax.exe их нет
    import sources as online
except ImportError:
    online = None
import sysinfo
from config import IMG_CACHE, IMG_HOSTS, REST_ALLOWED, SAFE_VAL, SHIKI, SUB_EXT, USER_AGENT, WEB_DIR
from media import enhanced, is_allowed_media, pick_folder, scan_library, srt_to_vtt
from shiki_data import (cached_api, clear_api_cache, coll_detail, colls_index, colls_search, drop_cached,
                        reviews_page, upstream, user_colls)
from state import lite_mode, read_for, write_from
from windows import _win_toast, foreground_window, open_app_window, quit_app, set_topmost

# Экран, на который должно перейти главное окно (клик по уведомлению Windows → Animax.pyw → сюда).
# Окно спрашивает /api/goto раз в пару секунд и забирает его.
_pending_nav: list[str | None] = [None]


def set_pending_nav(h: str) -> None:
    _pending_nav[0] = h


# Кэш картинок не должен расти бесконечно: на слабом ПК держим его меньше.
_img_lock = threading.Lock()
_img_writes = 0


TEMP_FILE_GRACE = 600  # сек.: столько не трогаем недописанный файл кэша — загрузка не длится дольше


def _img_cache_cap() -> int:
    return (250 if lite_mode() else 400) * 1024 * 1024


def _trim_img_cache(force: bool = False) -> None:
    global _img_writes
    with _img_lock:
        _img_writes += 1
        if not force and _img_writes % 40:
            return
    now = time.time()
    files = []
    try:
        for f in IMG_CACHE.iterdir():
            if not f.is_file():
                continue
            st = f.stat()
            # свежие .part и .tmp прямо сейчас дописывает другой поток (image(), media.enhanced): удалишь — его
            # запрос упадёт. Старые — брошены при аварийном выходе, их чистим как обычные файлы.
            if f.suffix in (".part", ".tmp") and now - st.st_mtime < TEMP_FILE_GRACE:
                continue
            files.append((st.st_mtime, st.st_size, f))
    except OSError:
        return
    cap = _img_cache_cap()
    total = sum(size for _, size, _ in files)
    if total <= cap:
        return
    for _, size, f in sorted(files):  # сначала самые старые
        if total <= cap:
            break
        try:
            f.unlink()
        except OSError:
            continue
        total -= size


class Handler(BaseHTTPRequestHandler):
    server_version = "Animax/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    # ---------- ответы ----------
    def send_bytes(self, data: bytes, ctype: str, code: int = 200, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def send_json(self, obj, code: int = 200):
        self.send_bytes(json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8", code)

    def read_body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def host_ok(self) -> bool:
        # Защита от DNS rebinding: чужой сайт может подменить свой домен на 127.0.0.1 и читать
        # отсюда закладки и токены. Настоящие запросы окна Animax всегда идут на 127.0.0.1:порт.
        port = self.server.server_address[1]
        return (self.headers.get("Host") or "").lower() in (f"127.0.0.1:{port}", f"localhost:{port}")

    # ---------- маршруты ----------
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(url.query)
        route = url.path
        if not self.host_ok():
            return self.send_json({"error": "forbidden"}, 403)
        try:
            if route == "/api/ping":
                return self.send_json({"app": "Animax"})
            if route == "/api/sys":
                return self.send_json({**sysinfo.info(), "lite": lite_mode(), "online": online is not None})
            if online is None and route.startswith(("/api/online", "/api/dubs")):
                return self.send_json({"dubs": [], "counts": {}, "sample": 0, "error": "Онлайн-источников в этой версии нет"},
                                      200 if route == "/api/online" else 404)
            if route == "/api/goto":
                h, _pending_nav[0] = _pending_nav[0], None
                return self.send_json({"hash": h})
            if route.startswith(("/api/auth/", "/oauth/", "/api/shiki/")):
                return self.auth_get(route, q)
            if route == "/api/state":
                return self.send_json(read_for(q.get("win", [""])[0][:40]))
            if route == "/api/rest":
                return self.rest(q.get("p", [""])[0])
            if route == "/api/reviews":
                return self.reviews(q)
            if route == "/api/attitudes":
                return self.attitudes(q)
            if route.startswith("/api/colls") or route == "/api/coll":
                return self.colls(route, q)
            if route == "/api/library":
                return self.send_json(scan_library())
            if route == "/api/online":
                return self.online_dubs(q.get("p", [""])[0])
            if route == "/api/dubs":
                # словарь всех озвучек Kodik + сколько популярных тайтлов
                # озвучено (counts[_sample] — размер выборки скана)
                counts = online.dubs_counts()
                return self.send_json({"dubs": online.dubs_list(),
                                       "counts": counts, "sample": counts.get("_sample") or 0})
            if route == "/api/dubs/find":
                # каталог тайтлов озвучки: ?tid=<id>&q=<название>&page=<n>
                # + остальные условия фильтра (kind, status, genre, score,
                # duration, rating, season, order) — как на Shikimori-REST.
                extra = {}
                for k in ("kind", "status", "genre", "score", "duration",
                          "rating", "season", "order"):
                    v = (q.get(k, [""])[0] or "").strip()
                    if v and SAFE_VAL.match(v):
                        extra[k] = v
                sq = (q.get("q", [""])[0] or "").strip()[:80]
                page = (q.get("page", [""])[0] or "1").strip()
                try:
                    return self.send_json(online.dubs_catalog(
                        q.get("tid", [""])[0], sq, limit=50, extra=extra,
                        page=int(page) if page.isdigit() else 1))
                except online.SourceError as e:
                    return self.send_json({"error": str(e)}, 400)
                except (urllib.error.URLError, TimeoutError) as e:
                    return self.send_json({"error": f"Нет связи с источниками: {e}"}, 502)
            if route == "/api/online/stream":
                return self.online_stream(
                    q.get("p", [""])[0], q.get("d", [""])[0], q.get("e", [""])[0])
            if route == "/api/cache":
                files = [f for f in IMG_CACHE.iterdir() if f.is_file()]
                return self.send_json({"files": len(files), "bytes": sum(f.stat().st_size for f in files)})
            if route == "/img":
                w = q.get("w", ["0"])[0]
                return self.image(q.get("u", [""])[0], min(int(w), 2400) if w.isdigit() else 0)
            if route == "/media":
                return self.media(q.get("path", [""])[0])
            if route == "/sub":
                return self.subtitle(q.get("path", [""])[0])
            return self.static(route)
        except (ConnectionError, BrokenPipeError):
            pass
        except Exception as e:  # noqa: BLE001 — сервер не должен падать из-за одного запроса
            try:
                self.send_json({"error": str(e)}, 500)
            except OSError:
                pass

    do_HEAD = do_GET

    def do_POST(self):
        route = urllib.parse.urlsplit(self.path).path
        if not self.host_ok():
            return self.send_json({"error": "forbidden"}, 403)
        # Менять данные можно только из окна Animax (или без Origin — например, curl из «Закрыть Animax.bat»),
        # иначе любой открытый в браузере сайт мог бы отправить сюда запрос.
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlsplit(origin).hostname not in ("127.0.0.1", "localhost"):
            return self.send_json({"error": "forbidden"}, 403)
        try:
            if route.startswith(("/api/auth/", "/api/shiki/")):
                return self.auth_post(route)
            if route == "/api/open-url":
                # открыть ссылку в обычном браузере Windows — только Shikimori
                url = str(json.loads(self.read_body() or b"{}").get("url", ""))
                if not url.startswith(SHIKI + "/"):
                    return self.send_json({"error": "forbidden"}, 403)
                os.startfile(url)
                return self.send_json({"ok": True})
            if route == "/api/quit":
                self.send_json({"ok": True})
                threading.Thread(target=quit_app, daemon=True).start()
                return
            if route == "/api/gql":
                return self.gql(self.read_body())
            if route == "/api/state":
                state = json.loads(self.read_body() or b"{}")
                if not isinstance(state, dict):
                    return self.send_json({"error": "bad state"}, 400)
                return self.send_json(write_from(state))  # сливает изменения разных окон
            if route == "/api/cache/clear":
                for f in IMG_CACHE.iterdir():
                    if f.is_file():
                        f.unlink(missing_ok=True)
                clear_api_cache()
                return self.send_json({"ok": True})
            if route == "/api/pick-folder":
                return self.send_json({"path": pick_folder()})
            if route == "/api/open-external":
                p = Path(json.loads(self.read_body() or b"{}").get("path", ""))
                if p.is_file() and is_allowed_media(p):
                    os.startfile(p)  # системный плеер (VLC, «Кино и ТВ» и т.п.)
                    return self.send_json({"ok": True})
                return self.send_json({"error": "not found"}, 404)
            if route == "/api/open-window":
                # открытие просмотра в отдельном окне приложения: {"url": "#/watch?..."}
                frag = (json.loads(self.read_body() or b"{}").get("url") or "").strip()
                if not frag.startswith("#/watch") or len(frag) > 300 or any(c.isspace() for c in frag):
                    return self.send_json({"error": "bad url"}, 400)
                port = self.server.server_address[1]
                if open_app_window(frag, port):
                    return self.send_json({"ok": True})
                return self.send_json({"error": "edge not found"}, 500)
            if route == "/api/pin-window":
                # «поверх всех окон» применяется к окну, откуда нажали кнопку (оно сейчас активное)
                on = bool((json.loads(self.read_body() or b"{}")).get("on"))
                hwnd = foreground_window()
                if not hwnd:
                    return self.send_json({"error": "no window"}, 400)
                set_topmost(hwnd, on)
                return self.send_json({"ok": True})
            if route == "/api/goto":
                h = str(json.loads(self.read_body() or b"{}").get("hash") or "")
                if not h.startswith("#/") or len(h) > 300:
                    return self.send_json({"error": "bad hash"}, 400)
                set_pending_nav(h)
                return self.send_json({"ok": True})
            if route == "/api/notify":
                # тост-уведомление на рабочем столе: {"title": "...", "body": "...", "href": "#/anime/1"}
                # клик по нему откроет Animax на экране href (ссылка animax:, её регистрирует Animax.pyw)
                d = json.loads(self.read_body() or b"{}")
                href = str(d.get("href") or "#/notifications")
                if not href.startswith("#/") or len(href) > 300:
                    href = "#/notifications"
                ok, err = _win_toast(str(d.get("title") or "Animax")[:80],
                                     str(d.get("body") or "")[:220],
                                     "animax:open?h=" + urllib.parse.quote(href, safe=""))
                return self.send_json({"ok": True} if ok else {"error": err or "toast failed"}, 500 if not ok else 200)
            self.send_json({"error": "not found"}, 404)
        except Exception as e:  # noqa: BLE001
            self.send_json({"error": str(e)}, 500)

    # ---------- вход через Shikimori и комментарии от имени пользователя ----------
    def redirect_uri(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/oauth/callback"

    def auth_get(self, route: str, q: dict):
        if route == "/api/auth/status":
            return self.send_json(shiki_auth.status(self.redirect_uri()))
        if route == "/api/shiki/review-topic":
            # топик отзыва: в нём комментарии к отзыву (читается без входа)
            rid = int(q.get("id", ["0"])[0] or 0)
            try:
                data = upstream(SHIKI + f"/api/topics?forum=all&linked_type=Review&linked_id={rid}&limit=1")
            except (urllib.error.URLError, TimeoutError) as e:
                return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
            return self.send_bytes(data, "application/json; charset=utf-8")
        if route == "/api/shiki/rates":
            try:
                return self.send_json(shiki_auth.list_rates())
            except shiki_auth.AuthError as e:
                return self.send_json({"error": str(e)}, 401)
            except (urllib.error.URLError, TimeoutError) as e:
                return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
        if route == "/api/auth/login":
            try:
                return self.send_json({"url": shiki_auth.login_url(self.redirect_uri())})
            except shiki_auth.AuthError as e:
                return self.send_json({"error": str(e)}, 400)
        if route == "/oauth/callback":
            try:
                user = shiki_auth.finish_login(q.get("code", [""])[0], self.redirect_uri())
                text = f"Готово! Ты вошёл как {user.get('nickname') or 'пользователь'}. Это окно закроется само."
            except (shiki_auth.AuthError, urllib.error.URLError, ValueError) as e:
                text = f"Не получилось войти: {e}"
            page = (f"<!doctype html><meta charset=utf-8><title>Animax</title>"
                    f"<body style='font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh'>"
                    f"<p>{text.replace('<', '&lt;')}</p><script>setTimeout(() => window.close(), 1500)</script>")
            return self.send_bytes(page.encode("utf-8"), "text/html; charset=utf-8")
        self.send_json({"error": "not found"}, 404)

    def auth_post(self, route: str):
        body = json.loads(self.read_body() or b"{}")
        try:
            if route == "/api/auth/config":
                shiki_auth.configure(body.get("app_name", ""), body.get("client_id", ""), body.get("client_secret", ""))
                return self.send_json({"ok": True})
            if route == "/api/auth/code":  # код, вставленный вручную (если Shikimori не перенаправил обратно)
                return self.send_json({"user": shiki_auth.finish_login(body.get("code", ""), self.redirect_uri())})
            if route == "/api/auth/logout":
                shiki_auth.logout()
                return self.send_json({"ok": True})
            if route == "/api/shiki/comment":
                code, data = shiki_auth.post_comment(body.get("topic_id", 0), str(body.get("body", ""))[:5000])
                return self.send_bytes(data or b"{}", "application/json; charset=utf-8", code)
            if route == "/api/shiki/review":
                op = body.get("opinion") if body.get("opinion") in ("positive", "neutral", "negative") else "neutral"
                if body.get("id"):  # изменить (или просто обновить голоса — тогда шлём то же мнение)
                    fields = {"opinion": op}
                    if body.get("body"):
                        fields["body"] = str(body["body"])[:20000]
                    code, data = shiki_auth.update_review(body["id"], fields)
                else:
                    code, data = shiki_auth.create_review(body.get("anime_id", 0), str(body.get("body", ""))[:20000], op)
                return self.send_bytes(data or b"{}", "application/json; charset=utf-8", code)
            if route == "/api/shiki/review/delete":
                code, data = shiki_auth.delete_review(body.get("id", 0))
                return self.send_bytes(data or b"{}", "application/json; charset=utf-8", code)
            if route == "/api/shiki/rate":
                code, data = shiki_auth.save_rate(body.get("target_id", 0), str(body.get("status", "planned")),
                                                  body.get("score", 0), body.get("episodes", 0), body.get("rate_id"))
                return self.send_bytes(data or b"{}", "application/json; charset=utf-8", code)
            if route == "/api/shiki/rate/delete":
                code, data = shiki_auth.delete_rate(body.get("rate_id", 0))
                return self.send_bytes(data or b"{}", "application/json; charset=utf-8", code)
            if route == "/api/shiki/comment/delete":
                code, data = shiki_auth.delete_comment(body.get("id", 0))
                return self.send_bytes(data or b"{}", "application/json; charset=utf-8", code)
        except shiki_auth.AuthError as e:
            return self.send_json({"error": str(e)}, 401)
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
        self.send_json({"error": "not found"}, 404)

    # ---------- обработчики ----------
    # онлайн-источники (AniLiberty, Kodik): список озвучек и разрешение серий
    def online_dubs(self, sid: str):
        if not sid.strip().replace("-", "").isdigit():
            return self.send_json({"error": "нужен Shikimori-ID (p=)"}, 400)
        try:
            self.send_json(online.online_dubs(sid))
        except Exception as e:  # noqa: BLE001
            self.send_json({"dubs": [], "errors": [str(e)]})

    def online_stream(self, sid: str, dub: str, ep: str):
        if not sid.strip() or not dub:
            return self.send_json({"error": "нужны параметры p=, d=, e="}, 400)
        try:
            data = online.online_stream(sid, dub, ep)
            # прямые ссылки сторонних CDN отдаём как есть; embed обёрнуты во фронтенде
            self.send_json(data)
        except online.SourceError as e:
            self.send_json({"error": str(e)}, 404)
        except Exception as e:  # noqa: BLE001
            self.send_json({"error": str(e)}, 500)

    def gql(self, body: bytes):
        key = "gql:" + hashlib.sha1(body).hexdigest()
        self.drop_if_fresh(key)
        fetch = lambda: upstream(SHIKI + "/api/graphql", body)  # noqa: E731
        try:
            # случайную выборку не кэшируем — иначе 10 минут подряд выпадает один и тот же тайтл
            data = fetch() if b"order: random" in body else cached_api(key, fetch)
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"errors": [{"message": f"Нет связи с Shikimori: {e}"}]}, 502)
        self.send_bytes(data, "application/json; charset=utf-8")

    def rest(self, path: str):
        base = path.split("?")[0]
        if not REST_ALLOWED.match(base):
            return self.send_json({"error": "forbidden"}, 403)
        self.drop_if_fresh("rest:" + path)
        try:
            data = cached_api("rest:" + path, lambda: upstream(SHIKI + path))
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
        self.send_bytes(data, "application/json; charset=utf-8")

    def colls(self, route: str, q: dict):
        """Коллекции Shikimori: /api/colls?q=&sort=&anime=&page=, /api/coll?id=, /api/colls/user?nick=, /api/colls/status"""
        try:
            if route == "/api/colls":
                return self.send_json(colls_search(q))
            if route == "/api/colls/status":
                return self.send_json(colls_index().status())
            if route == "/api/coll":
                cid = q.get("id", [""])[0]
                if not cid.isdigit():
                    return self.send_json({"error": "bad request"}, 400)
                self.drop_if_fresh(f"coll:{cid}")
                return self.send_json(coll_detail(int(cid)))
            if route == "/api/colls/user":
                nick = q.get("nick", [""])[0].strip()
                if not nick or len(nick) > 60:
                    return self.send_json({"error": "bad request"}, 400)
                key = "ucolls:" + nick
                self.drop_if_fresh(key)
                return self.send_bytes(cached_api(key, lambda: json.dumps(user_colls(nick), ensure_ascii=False).encode()),
                                       "application/json; charset=utf-8")
        except urllib.error.HTTPError as e:
            return self.send_json({"error": "Коллекция не найдена" if e.code == 404 else f"Shikimori ответил {e.code}"}, 502)
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
        return self.send_json({"error": "not found"}, 404)

    def drop_if_fresh(self, key: str):
        # кнопка ⟳ у вкладки: запросы этой вкладки идут мимо кэша, свежий ответ снова кладём в кэш
        if self.headers.get("X-Fresh") == "1":
            drop_cached(key)

    def reviews(self, q: dict):
        """Отзывы других пользователей: ?id=<тайтл>&opinion=positive|neutral|negative&page=<n>"""
        aid, page = q.get("id", [""])[0], q.get("page", ["1"])[0]
        if not aid.isdigit() or not page.isdigit():
            return self.send_json({"error": "bad request"}, 400)
        try:
            return self.send_json(reviews_page(int(aid), q.get("opinion", [""])[0], int(page)))
        except urllib.error.HTTPError as e:
            return self.send_json({"error": f"Shikimori ответил {e.code}"}, 502)
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)

    def attitudes(self, q: dict):
        """Отношение комментаторов к тайтлу: ?anime=<id>&users=1,2,3 →
        {uid: {score, status, opinion}} — оценка и статус из открытого списка пользователя,
        opinion — мнение его отзыва на этот тайтл, если отзыв есть."""
        aid = q.get("anime", [""])[0]
        users = [u for u in q.get("users", [""])[0].split(",") if u.isdigit()][:40]
        if not aid.isdigit():
            return self.send_json({"error": "bad request"}, 400)
        opinions = {}
        try:
            for page in range(1, 6):  # первые 40 отзывов — дальше слишком долго
                d = reviews_page(int(aid), "", page)
                for r in d["items"]:
                    opinions.setdefault(r["user"]["id"], r["opinion"])
                if d["done"]:
                    break
        except (urllib.error.URLError, TimeoutError):
            pass
        out = {}
        for u in dict.fromkeys(users):
            path = f"/api/v2/user_rates?user_id={u}&target_id={aid}&target_type=Anime"
            try:
                rate = (json.loads(cached_api("rest:" + path, lambda: upstream(SHIKI + path))) or [{}])[0]
            except (urllib.error.URLError, TimeoutError, ValueError):
                rate = {}  # закрытый список или нет связи — просто не знаем
            out[u] = {"score": rate.get("score") or 0, "status": rate.get("status") or "", "opinion": opinions.get(int(u), "")}
        self.send_json(out)

    def image(self, u: str, want: int = 0):
        if u.startswith("//"):
            u = "https:" + u
        elif u.startswith("/"):
            u = SHIKI + u
        host = urllib.parse.urlsplit(u).hostname or ""
        if host not in IMG_HOSTS:
            return self.send_json({"error": "forbidden"}, 403)
        h = hashlib.sha1(u.encode()).hexdigest()
        f = IMG_CACHE / h
        if not f.exists():
            try:
                data = shiki_net.fetch_image(u, USER_AGENT)
            except OSError:  # нет сети, хост недоступен или ответил ошибкой
                return self.send_bytes(b"", "text/plain", 404)
            if not data:
                return self.send_bytes(b"", "text/plain", 404)
            tmp = f.with_name(f"{f.name}.{threading.get_ident()}.part")
            tmp.write_bytes(data)
            try:
                tmp.replace(f)
            except PermissionError:
                # Ту же картинку (постер в двух размерах) качал ещё один поток: он уже положил файл и читает его,
                # а открытый файл Windows заменить не даёт. Его копия ничем не хуже — берём её.
                tmp.unlink(missing_ok=True)
                if not f.exists():
                    raise
            _trim_img_cache()
        if want:
            big = enhanced(f, want, upscale=not lite_mode())  # на слабом ПК не тратим процессор на увеличение
            if big:
                return self.send_bytes(big.read_bytes(), "image/jpeg", extra={"Cache-Control": "max-age=604800"})
        data = f.read_bytes()
        ctype = mimetypes.guess_type(urllib.parse.urlsplit(u).path)[0] or "image/jpeg"
        self.send_bytes(data, ctype, extra={"Cache-Control": "max-age=604800"})

    def media(self, path: str):
        p = Path(path)
        if not path or not p.is_file() or not is_allowed_media(p):
            return self.send_bytes(b"", "text/plain", 404)
        size = p.stat().st_size
        ctype = {".mkv": "video/x-matroska", ".ts": "video/mp2t"}.get(
            p.suffix.lower(), mimetypes.guess_type(p.name)[0] or "video/mp4")
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m:
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            elif m.group(2):
                start = max(0, size - int(m.group(2)))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        length = end - start + 1
        self.send_response(206 if m else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if m:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(p, "rb") as fh:
            fh.seek(start)
            left = length
            while left > 0:
                chunk = fh.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def subtitle(self, path: str):
        p = Path(path)
        if not path or not p.is_file() or not is_allowed_media(p) or p.suffix.lower() not in SUB_EXT:
            return self.send_bytes(b"", "text/plain", 404)
        raw = p.read_bytes()
        text = None
        for enc in ("utf-8-sig", "cp1251"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:  # редкая кодировка — лучше субтитры с «?», чем ошибка
            text = raw.decode("utf-8", "replace")
        if p.suffix.lower() == ".srt":
            text = srt_to_vtt(text)
        self.send_bytes(text.encode("utf-8"), "text/vtt; charset=utf-8")

    def static(self, route: str):
        rel = urllib.parse.unquote(route).lstrip("/") or "index.html"
        f = (WEB_DIR / rel).resolve()
        if not f.is_relative_to(WEB_DIR) or not f.is_file():
            f = WEB_DIR / "index.html"
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json", "svg+xml")):
            ctype += "; charset=utf-8"
        self.send_bytes(f.read_bytes(), ctype, extra={"Cache-Control": "no-cache"})




class AppServer(ThreadingHTTPServer):
    # HTTPServer сам включает SO_REUSEADDR, а в Windows с ним вторая программа может сесть на тот же
    # занятый порт и забирать часть запросов окна (перехват порта). Поэтому порт занимаем только для себя.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # есть только в Windows
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_server(port: int) -> ThreadingHTTPServer:
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("image/svg+xml", ".svg")
    mimetypes.add_type("image/webp", ".webp")
    # Счётчики озвучек больше не считаем при старте: это нужно только странице
    # «Озвучки» и запускается при её открытии (на слабом ПК — не запускается).
    threading.Thread(target=_trim_img_cache, kwargs={"force": True}, daemon=True).start()
    srv = AppServer(("127.0.0.1", port), Handler)
    srv.daemon_threads = True
    return srv


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    print(f"Animax: http://127.0.0.1:{port}")
    srv = make_server(port)
    shiki_net.warm_up(SHIKI)
    srv.serve_forever()
