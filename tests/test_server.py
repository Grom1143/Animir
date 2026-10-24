"""Локальный сервер: защита от чужих сайтов (Host / Origin), сохранение состояния, статика.

Сервер поднимается на свободном порту с временной папкой данных — настоящие закладки не трогаются.
Интернет не нужен: проверяются только локальные маршруты.
"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

os.environ["APPDATA"] = tempfile.mkdtemp(prefix="animax-test-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.make_server(0)  # 0 — любой свободный порт
        cls.port = cls.srv.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def req(self, path, data=None, headers=None):
        r = urllib.request.Request(self.base + path, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_ping(self):
        code, body = self.req("/api/ping")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {"app": "Animax"})

    def test_foreign_host_is_rejected(self):
        # DNS rebinding: чужой домен, указывающий на 127.0.0.1
        code, _ = self.req("/api/state", headers={"Host": f"evil.example:{self.port}"})
        self.assertEqual(code, 403)

    def test_foreign_origin_cannot_write(self):
        code, _ = self.req("/api/state", data=b"{}", headers={"Origin": "https://evil.example"})
        self.assertEqual(code, 403)

    def test_state_roundtrip_and_merge(self):
        _, a = self.req("/api/state?win=a")
        _, b = self.req("/api/state?win=b")
        rev_a, rev_b = json.loads(a)["_rev"], json.loads(b)["_rev"]
        code, r1 = self.req("/api/state", data=json.dumps({"progress": {"x": 1}, "_base": rev_b, "_win": "b"}).encode())
        self.assertEqual(code, 200)
        _, r2 = self.req("/api/state", data=json.dumps({"settings": {"theme": "light"}, "_base": rev_a, "_win": "a"}).encode())
        merged = json.loads(r2)["state"]
        self.assertEqual(merged["progress"], {"x": 1})
        self.assertEqual(merged["settings"], {"theme": "light"})

    def test_bad_state_body(self):
        code, _ = self.req("/api/state", data=b"[1, 2]")
        self.assertEqual(code, 400)

    def test_static_and_spa_fallback(self):
        code, body = self.req("/")
        self.assertEqual(code, 200)
        self.assertIn(b"Animax", body)
        code, body = self.req("/../../config.py")  # выйти из папки web/ нельзя
        self.assertEqual(code, 200)
        self.assertIn(b"<!doctype html>", body)

    def test_media_outside_library_is_forbidden(self):
        code, _ = self.req("/media?path=" + urllib.request.quote(str(Path(__file__))))
        self.assertEqual(code, 404)

    def test_image_proxy_only_known_hosts(self):
        code, _ = self.req("/img?u=" + urllib.request.quote("https://evil.example/a.jpg"))
        self.assertEqual(code, 403)


if __name__ == "__main__":
    unittest.main()
