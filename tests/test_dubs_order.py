"""Порядок озвучек у тайтла: сначала самые популярные студии, субтитры - в конце.

Популярность - сколько из топ-300 тайтлов студия озвучила (скан в sources/counts.py).
Интернет не нужен: счётчики и источники подменяем.
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import animir.sources as sources  # noqa: E402
from animir.sources import counts  # noqa: E402


class PopOfTest(unittest.TestCase):
    def setUp(self):
        self.saved_counts = dict(counts._counts)
        self.saved_labels = dict(counts._labels)
        counts._counts.clear()
        counts._counts.update({"1": 5})  # чтобы dubs_counts не полез в сеть
        counts._labels.clear()
        counts._labels.update({"anidub": 257, "anilibriatv": 239, "animedia": 134})

    def tearDown(self):
        counts._counts.clear()
        counts._counts.update(self.saved_counts)
        counts._labels.clear()
        counts._labels.update(self.saved_labels)

    def test_exact_name(self):
        self.assertEqual(counts.pop_of("AniDUB"), 257)

    def test_longer_name_of_same_studio(self):
        # Kodik пишет полное имя, Anixart - короткое
        self.assertEqual(counts.pop_of("AniDUB Online 18+"), 257)
        self.assertEqual(counts.pop_of("AniLibria.TV"), 239)

    def test_studio_and_server(self):
        # «AniMedia · Sibnet»: до «·» - студия, после - сервер
        self.assertEqual(counts.pop_of("AniMedia · Sibnet"), 134)

    def test_unknown_studio_is_zero(self):
        self.assertEqual(counts.pop_of("Совсем новая студия"), 0)
        self.assertEqual(counts.pop_of(""), 0)


class OnlineDubsOrderTest(unittest.TestCase):
    def test_most_popular_first_and_subtitles_last(self):
        small = {"key": "k1", "src": "Kodik", "label": "Малая студия", "type": "voice", "count": 12}
        subs = {"key": "k2", "src": "Kodik", "label": "Субтитры · X", "type": "subtitles", "count": 12}
        big = {"key": "k3", "src": "Anixart", "label": "AniDUB · Sibnet", "type": "voice", "count": 12}
        popular = lambda label: 257 if "AniDUB" in label else 3  # noqa: E731
        with mock.patch.object(sources, "_anix_dubs", return_value=[big]), \
             mock.patch.object(sources, "_aniliberty_dubs", return_value=[]), \
             mock.patch.object(sources, "_kodik_dubs", return_value=[small, subs]), \
             mock.patch.object(sources.counts, "pop_of", side_effect=popular):
            dubs = sources.online_dubs("1")["dubs"]
        self.assertEqual([d["key"] for d in dubs], ["k3", "k1", "k2"])
        self.assertEqual(dubs[0]["pop"], 257)  # странице есть что показать серым


if __name__ == "__main__":
    unittest.main()
