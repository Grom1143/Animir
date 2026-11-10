"""Скачивание: имена файлов и нормализация ссылок (без сети)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import downloader  # noqa: E402


class NameTest(unittest.TestCase):
    def test_removes_forbidden_chars(self):
        self.assertEqual(downloader._clean('Ванпанчмен: серия 1/2?'), 'Ванпанчмен серия 1 2')

    def test_keeps_cyrillic_and_trims(self):
        self.assertEqual(downloader._clean('  Тикава  '), 'Тикава')

    def test_empty_falls_back(self):
        self.assertEqual(downloader._clean(''), 'Серия')
        self.assertEqual(downloader._clean('???'), 'Серия')

    def test_long_name_is_cut(self):
        self.assertLessEqual(len(downloader._clean('я' * 400)), 120)


class UrlTest(unittest.TestCase):
    def test_protocol_relative_gets_https(self):
        # ссылки Kodik приходят как //cloud2.solodcdn.com/... - urllib так не умеет
        self.assertEqual(downloader._abs('//cdn.example/a.m3u8'), 'https://cdn.example/a.m3u8')

    def test_https_left_as_is(self):
        self.assertEqual(downloader._abs('https://cdn.example/a.mp4'), 'https://cdn.example/a.mp4')


if __name__ == "__main__":
    unittest.main()
