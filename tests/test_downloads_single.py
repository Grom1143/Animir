"""Склейка HLS в один файл: проверка без интернета, на локальном сервере.

Пригодится, чтобы не ждать настоящую серию: плейлист и сегменты отдаёт заглушка.
"""
import http.server
import pathlib
import sys
import tempfile
import threading
import unittest
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

import animir.downloads as downloads  # noqa: E402


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):  # noqa: N802 - имя задано базовым классом
        if self.path == "/one.m3u8":
            body, ctype = b"#EXTM3U\n#EXTINF:1,\n/a.ts\n#EXTINF:1,\n/b.ts\n", "application/vnd.apple.mpegurl"
        elif self.path == "/two.m3u8":
            body, ctype = b"#EXTM3U\n#EXTINF:1,\n/c.ts\n", "application/vnd.apple.mpegurl"
        elif self.path == "/a.ts":
            body, ctype = b"A" * 1000, "video/mp2t"
        elif self.path == "/b.ts":
            body, ctype = b"B" * 2000, "video/mp2t"
        elif self.path == "/c.ts":
            body, ctype = b"C" * 500, "video/mp2t"
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # тишина в консоли тестов
        pass


class HlsConcatTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        self.dir = pathlib.Path(tempfile.gettempdir()) / f"animir-dl-{uuid.uuid4().hex[:8]}"
        self.dir.mkdir()
        self.job = {"id": "t", "done": 0, "total": 1, "part": 0.0, "percent": 0.0}

    def tearDown(self):
        for f in self.dir.glob("*"):
            f.unlink(missing_ok=True)
        self.dir.rmdir()

    def test_segments_are_saved_in_order(self):
        out = self.dir / "one.ts"
        downloads._save_hls(self.base + "/one.m3u8", out, self.job, 0)
        self.assertEqual(out.read_bytes(), b"A" * 1000 + b"B" * 2000)

    def test_two_episodes_go_into_one_file(self):
        out = self.dir / "all.ts"
        with out.open("wb") as f:
            downloads._hls_into(f, self.base + "/one.m3u8", self.job, 0)
            downloads._hls_into(f, self.base + "/two.m3u8", self.job, 1)
        self.assertEqual(out.read_bytes(), b"A" * 1000 + b"B" * 2000 + b"C" * 500)

    def test_progress_grows_and_stops_before_hundred(self):
        out = self.dir / "p.ts"
        downloads._save_hls(self.base + "/one.m3u8", out, self.job, 0)
        self.assertLess(self.job["percent"], 100)
        self.assertGreater(self.job["percent"], 0)


if __name__ == "__main__":
    unittest.main()
