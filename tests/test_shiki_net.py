"""Сеть до Shikimori: «отдых» недоступного хоста и повторное использование соединений.

Сеть подменяется (таймауты) или поднимается свой маленький HTTP-сервер на 127.0.0.1. Интернет не нужен.
"""
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import shiki_net  # noqa: E402


class HostPauseTest(unittest.TestCase):
    def setUp(self):
        shiki_net._host_fail.clear()
        shiki_net._host_down.clear()
        patcher = mock.patch.object(shiki_net, "_urlopen", side_effect=TimeoutError("timed out"))
        self.urlopen = patcher.start()
        self.addCleanup(patcher.stop)

    def fail_times(self, url, n):
        for _ in range(n):
            with self.assertRaises(OSError):
                shiki_net.fetch_image(url, "test")

    def test_blocked_third_party_host_rests(self):
        # YouTube заблокирован: после 3 неудач подряд больше не ждём таймаута, отвечаем сразу
        self.fail_times("https://i.ytimg.com/vi/x/hqdefault.jpg", 5)
        self.assertEqual(self.urlopen.call_count, shiki_net.HOST_FAILS)

    def test_shikimori_is_never_paused(self):
        # С Shikimori все постеры: пара медленных ответов не должна оставить Animax без картинок на 5 минут
        self.fail_times("https://shikimori.io/uploads/poster/animes/1/main.webp", 5)
        self.assertEqual(self.urlopen.call_count, 5)


class Upstream(BaseHTTPRequestHandler):
    """Сервер-заглушка: запоминает, по какому соединению (порт клиента) пришёл каждый запрос."""
    protocol_version = "HTTP/1.1"  # соединение остаётся открытым между запросами
    seen: list = []

    def log_message(self, *a):
        pass

    def reply(self, code, body=b"ok", headers=()):
        self.send_response(code)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        Upstream.seen.append((self.client_address[1], self.command, self.path))
        if self.path == "/drop":  # ответить и молча закрыть: соединение в пуле «умрёт»
            self.reply(200)
            self.close_connection = True
        elif self.path == "/missing":
            self.reply(404, b"no such poster")
        elif self.path == "/moved":
            self.reply(302, b"", [("Location", "/ok")])
        else:
            self.reply(200)

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        Upstream.seen.append((self.client_address[1], self.command, self.path))
        self.reply(200, json.dumps({"type": self.headers.get("Content-Type"), "body": body.decode()}).encode())


class ConnectionReuseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        Upstream.seen = []
        shiki_net.close_idle()

    def get(self, path):
        return shiki_net.open_url(urllib.request.Request(self.base + path, headers={"User-Agent": "test"}), 5)

    def connections(self):
        return len({port for port, _, _ in Upstream.seen})

    def test_requests_reuse_one_connection(self):
        # До Shikimori TLS-рукопожатие идёт ~5 с, а запрос ~0,3 с: новое соединение на каждый запрос — главный тормоз
        for _ in range(3):
            self.assertEqual(self.get("/ok"), (200, b"ok"))
        self.assertEqual(self.connections(), 1)

    def test_images_reuse_connection_too(self):
        for _ in range(3):
            self.assertEqual(shiki_net.fetch_image(self.base + "/poster.jpg", "test"), b"ok")
        self.assertEqual(self.connections(), 1)

    def test_connection_closed_by_server_is_replaced(self):
        self.get("/drop")
        self.assertEqual(self.get("/ok"), (200, b"ok"))  # соединение из пула уже мёртвое — молча берём новое
        self.assertEqual(self.connections(), 2)

    def test_error_status_is_http_error_with_body(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.get("/missing")
        self.assertEqual(cm.exception.code, 404)
        self.assertEqual(cm.exception.read(), b"no such poster")
        self.assertEqual(self.get("/ok"), (200, b"ok"))  # после ошибки соединение по-прежнему годится
        self.assertEqual(self.connections(), 1)

    def test_redirect_is_followed(self):
        self.assertEqual(self.get("/moved"), (200, b"ok"))

    def test_post_sends_body_and_type(self):
        req = urllib.request.Request(self.base + "/api/graphql", data=b'{"query":"{x}"}',
                                     headers={"Content-Type": "application/json"})
        code, body = shiki_net.open_url(req, 5)
        self.assertEqual(json.loads(body), {"type": "application/json", "body": '{"query":"{x}"}'})

    def test_writes_never_go_over_old_connection(self):
        # Запрос, который что-то меняет (комментарий), нельзя повторять: при обрыве он мог дойти дважды.
        # Поэтому он всегда идёт по новому соединению, а не по тому, что мог уже закрыть сервер.
        self.get("/ok")
        shiki_net.open_url(urllib.request.Request(self.base + "/api/comments", data=b"text=hi", method="POST"), 5)
        self.assertEqual(self.connections(), 2)

    def test_dead_host_is_url_error(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        port = srv.server_address[1]
        srv.server_close()  # порт свободен — подключаться некуда
        with self.assertRaises(urllib.error.URLError):
            shiki_net.open_url(urllib.request.Request(f"http://127.0.0.1:{port}/ok"), 5)


if __name__ == "__main__":
    unittest.main()
