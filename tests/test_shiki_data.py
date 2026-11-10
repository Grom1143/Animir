"""Данные Shikimori для сервера: поиск коллекций, пока свой индекс ещё не собран."""
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

os.environ["APPDATA"] = os.path.join(tempfile.gettempdir(), f"animir-test-{uuid.uuid4().hex[:8]}")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import shiki_data  # noqa: E402


class CollsSearchTest(unittest.TestCase):
    def test_nothing_found_is_empty_list_not_error(self):
        # Shikimori на поиск без результатов отвечает {"content": null} - раньше это давало 500
        idx = mock.Mock(data={}, status=lambda: {"listed": False})
        with mock.patch.object(shiki_data, "colls_index", return_value=idx), \
                mock.patch.object(shiki_data, "shiki_text", return_value='{"content": null}'):
            got = shiki_data.colls_search({"q": ["фрирен"]})
        self.assertEqual(got["items"], [])
        self.assertTrue(got["done"])


if __name__ == "__main__":
    unittest.main()
