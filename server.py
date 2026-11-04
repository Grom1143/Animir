"""Анимир — локальный сервер.

Отдаёт интерфейс из папки web/, ходит в API Shikimori (каталог аниме),
кэширует картинки, хранит твои списки и отдаёт видео из твоих папок.
Запускается из Animir.pyw, сам по себе тоже работает: python server.py

Здесь — только общее: ответы, защита от чужих сайтов и выбор обработчика по таблице маршрутов (server_routes).
Сами обработчики — по темам: server_app (окна, состояние, медиатека), server_shiki (Shikimori),
server_online (онлайн-источники), server_files (картинки, видео, субтитры, интерфейс).
"""

import json
import mimetypes
import socket
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import shiki_net
import windows
from config import IMG_CACHE, SHIKI
from server_app import AppRoutes, set_pending_nav
from server_files import FileRoutes, _trim_img_cache
from server_online import OnlineRoutes, online
from server_routes import API_GROUPS, GET, POST
from server_shiki import ShikiRoutes

# Снаружи: make_server и set_pending_nav — для Animir.pyw; online, windows, IMG_CACHE — для тестов.
__all__ = ["Handler", "make_server", "set_pending_nav", "online", "windows", "IMG_CACHE"]


class Handler(AppRoutes, ShikiRoutes, OnlineRoutes, FileRoutes, BaseHTTPRequestHandler):
    server_version = "Animir/1.0"
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

    def json_body(self):
        # Не кэшируем на self: при HTTP/1.1 один Handler обслуживает несколько запросов подряд.
        return json.loads(self.read_body() or b"{}")

    # ---------- защита ----------
    def host_ok(self) -> bool:
        # Защита от DNS rebinding: чужой сайт может подменить свой домен на 127.0.0.1 и читать
        # отсюда закладки и токены. Настоящие запросы окна Анимир всегда идут на 127.0.0.1:порт.
        port = self.server.server_address[1]
        return (self.headers.get("Host") or "").lower() in (f"127.0.0.1:{port}", f"localhost:{port}")

    def origin_ok(self) -> bool:
        # Менять данные можно только из окна Анимир (или без Origin — например, curl из «Закрыть Анимир.bat»),
        # иначе любой открытый в браузере сайт мог бы отправить сюда запрос.
        origin = self.headers.get("Origin")
        return not origin or urllib.parse.urlsplit(origin).hostname in ("127.0.0.1", "localhost")

    # ---------- выбор обработчика ----------
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        route = url.path
        if not self.host_ok():
            return self.send_json({"error": "forbidden"}, 403)
        try:
            fn = GET.get(route)
            if fn:
                return fn(self, urllib.parse.parse_qs(url.query))
            if route.startswith(API_GROUPS):
                return self.send_json({"error": "not found"}, 404)
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
        if not self.host_ok() or not self.origin_ok():
            return self.send_json({"error": "forbidden"}, 403)
        try:
            fn = POST.get(route)
            if fn:
                return fn(self)
            self.send_json({"error": "not found"}, 404)
        except (ConnectionError, BrokenPipeError):
            pass
        except Exception as e:  # noqa: BLE001
            try:
                self.send_json({"error": str(e)}, 500)
            except OSError:
                pass


class AppServer(ThreadingHTTPServer):
    # HTTPServer сам включает SO_REUSEADDR, а в Windows с ним вторая программа может сесть на тот же
    # занятый порт и забирать часть запросов окна (перехват порта). Поэтому порт занимаем только для себя.
    allow_reuse_address = False

    def handle_error(self, request, client_address):
        # Клиент оборвал соединение (закрыли окно посреди загрузки картинки, браузер отменил запрос) — это не
        # ошибка сервера: раньше каждое такое событие печатало в лог трассировку на 20 строк.
        if isinstance(sys.exc_info()[1], (ConnectionError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)

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
    print(f"Анимир: http://127.0.0.1:{port}")
    srv = make_server(port)
    shiki_net.warm_up(SHIKI)
    srv.serve_forever()
