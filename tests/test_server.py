"""Локальный сервер: защита от чужих сайтов (Host / Origin), сохранение состояния, статика.

Сервер поднимается на свободном порту с временной папкой данных — настоящие закладки не трогаются.
Интернет не нужен: проверяются только локальные маршруты.
"""
import hashlib
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from unittest import mock

# Не tempfile.mkdtemp: он даёт папку с правами «только владелец», и в песочнице DeepSeek (ограниченный токен)
# внутри неё ничего не создать. config.py сам создаст эту папку при импорте.
os.environ["APPDATA"] = os.path.join(tempfile.gettempdir(), f"animax-test-{uuid.uuid4().hex[:8]}")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
import shiki_data  # noqa: E402


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

    def test_same_image_downloaded_twice_at_once(self):
        # Постер в двух размерах (srcset) качается двумя потоками сразу: второй кладёт файл в кэш, когда первый
        # уже положил его и читает. В Windows заменить открытый файл нельзя — было «Отказано в доступе» и 500.
        url = "https://shikimori.io/uploads/poster/animes/1/race.jpg"
        cached = server.IMG_CACHE / hashlib.sha1(url.encode()).hexdigest()
        readers = []

        def other_thread_won(u, ua):
            cached.write_bytes(b"poster")
            readers.append(open(cached, "rb"))
            return b"poster"

        with mock.patch.object(server.shiki_net, "fetch_image", side_effect=other_thread_won):
            try:
                code, body = self.req("/img?u=" + urllib.request.quote(url))
            finally:
                for r in readers:
                    r.close()
        self.assertEqual(code, 200)
        self.assertEqual(body, b"poster")
        self.assertEqual(list(server.IMG_CACHE.glob(cached.name + ".*.part")), [])  # временный файл не остался

    def test_port_cannot_be_hijacked(self):
        # Перехват порта: в Windows чужой сокет с SO_REUSEADDR мог сесть на уже занятый порт
        # и получать часть запросов окна (закладки, токен Shikimori).
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            with self.assertRaises(OSError):
                s.bind(("127.0.0.1", self.port))
        finally:
            s.close()


class ImageCacheTrimTest(unittest.TestCase):
    def make(self, name, age):
        f = server.IMG_CACHE / name
        f.write_bytes(b"x" * 100)
        t = time.time() - age
        os.utime(f, (t, t))
        self.addCleanup(f.unlink, missing_ok=True)
        return f

    def trim_to_nothing(self):
        with mock.patch.object(server, "_img_cache_cap", return_value=50):  # кэш «переполнен» — чистить всё, что можно
            server._trim_img_cache(force=True)

    def test_trim_keeps_files_being_written(self):
        # .part и .tmp прямо сейчас дописывает другой поток: удалить их — уронить тот запрос в 500
        old = self.make("trim-old", 3600)
        part = self.make("trim-new.123.part", 1)
        tmp = self.make("trim-new-w420.tmp", 1)
        self.trim_to_nothing()
        self.assertTrue(part.exists())
        self.assertTrue(tmp.exists())
        self.assertFalse(old.exists())

    def test_trim_removes_leftovers_of_a_crash(self):
        # Недописанные файлы, брошенные при аварийном выходе, не должны копиться вечно (замечание DeepSeek)
        part = self.make("trim-orphan.456.part", 3600)
        tmp = self.make("trim-orphan-w420.tmp", 3600)
        self.trim_to_nothing()
        self.assertFalse(part.exists())
        self.assertFalse(tmp.exists())


class UpstreamTest(unittest.TestCase):
    def idempotent_for(self, body):
        with mock.patch.object(shiki_data.shiki_net, "open_url", return_value=(200, b"{}")) as call:
            shiki_data.upstream("https://shikimori.io/api/graphql", body)
        return call.call_args.kwargs["idempotent"]

    def test_reads_may_go_over_pooled_connection(self):
        self.assertTrue(self.idempotent_for(None))
        self.assertTrue(self.idempotent_for(b'{"query":"{ animes(limit: 1) { id } }"}'))

    def test_mutation_is_never_repeated(self):
        # Мутацию при обрыве повторять нельзя — она могла дойти, и действие выполнилось бы дважды
        self.assertFalse(self.idempotent_for(b'{"query":"mutation { rate(id: 1, score: 9) { id } }"}'))


class RestartTest(unittest.TestCase):
    def test_restart_right_after_quit(self):
        # После «Выхода» Animax должен сразу запускаться снова, хотя старые соединения ещё в TIME_WAIT.
        srv = server.make_server(0)
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        for _ in range(5):
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=5).read()
        srv.shutdown()
        srv.server_close()
        again = server.make_server(port)
        again.server_close()


if __name__ == "__main__":
    unittest.main()
