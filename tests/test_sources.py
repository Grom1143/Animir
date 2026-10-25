"""Онлайн-озвучки (sources.py) ходят через пул соединений shiki_net.

Сервер-заглушку Upstream (считает TCP-соединения по порту клиента) берём из test_shiki_net;
интернет не нужен.
"""
import json
import sys
import threading
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # корень проекта: sources, shiki_net
sys.path.insert(0, str(Path(__file__).resolve().parent))          # папка tests: test_shiki_net

import shiki_net  # noqa: E402
import sources  # noqa: E402
from test_shiki_net import QuietServer, Upstream  # noqa: E402


class SourcesPoolTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = QuietServer(("127.0.0.1", 0), Upstream)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        Upstream.seen = []
        shiki_net.close_idle()

    def connections(self):
        return len({port for port, _, _ in Upstream.seen})

    # ---------- повторное использование соединений ----------
    def test_get_reuses_one_connection(self):
        # Каждый запрос sources раньше открывал новое соединение (для https — новое TLS-рукопожатие):
        # два обращения к одному адресу должны пройти по одному.
        for _ in range(2):
            self.assertEqual(sources._http(self.base + "/ok"), b"ok")
        self.assertEqual(self.connections(), 1)

    def test_post_reuses_one_connection(self):
        url = self.base + "/api/search"
        body = b"token=abc&title=x"
        for _ in range(2):
            raw = sources._http(url, "POST", body, "application/x-www-form-urlencoded")
            self.assertEqual(json.loads(raw.decode("utf-8", "replace")),
                             {"type": "application/x-www-form-urlencoded", "body": "token=abc&title=x"})
        self.assertEqual(self.connections(), 1)

    # ---------- повторы при ошибке ----------
    def test_server_500_retries_then_raises(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            sources._http(self.base + "/error", tries=2)
        self.assertEqual(cm.exception.code, 500)
        self.assertEqual([p for _, _, p in Upstream.seen].count("/error"), 2)

    # ---------- _kdk_probe ходит на зашитый адрес, поэтому подменяем сеть ----------
    def test_probe_calls_pooled_and_returns_hit(self):
        with mock.patch.object(sources, "kodik_token", return_value="tok"), \
             mock.patch.object(shiki_net, "urlopen_pooled",
                               return_value=(200, json.dumps({"results": [{"id": 42}]}).encode())) as pooled:
            hit = sources._kdk_probe("sid-probe-hit", "7")
        self.assertEqual(hit, {"id": 42})
        self.assertEqual(pooled.call_args.args[1], 15)          # прежний таймаут не меняем
        self.assertIs(pooled.call_args.kwargs["idempotent"], True)

    def test_probe_swallows_error_to_none(self):
        with mock.patch.object(sources, "kodik_token", return_value="tok"), \
             mock.patch.object(shiki_net, "urlopen_pooled", side_effect=urllib.error.URLError("down")) as pooled:
            hit = sources._kdk_probe("sid-probe-err", "7")
        self.assertIsNone(hit)
        self.assertIs(pooled.call_args.kwargs["idempotent"], True)


if __name__ == "__main__":
    unittest.main()
