"""Перенос закладок и входа из старых версий (Animax, AnyX) при первом запуске Анимира."""
import os
import shutil
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

os.environ["APPDATA"] = os.path.join(tempfile.gettempdir(), f"animir-test-{uuid.uuid4().hex[:8]}")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402


class MigrateTest(unittest.TestCase):
    def setUp(self):
        # не tempfile.mkdtemp — см. test_server.py
        self.root = Path(tempfile.gettempdir()) / f"animir-mig-{uuid.uuid4().hex[:8]}"
        self.root.mkdir()
        self.new = self.root / "Animir"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def old(self, name, text):
        d = self.root / name
        d.mkdir()
        (d / "state.json").write_text(text, "utf-8")
        return d

    def test_takes_newest_old_version_first(self):
        olds = [self.old("Animax", "из Animax"), self.old("AnyX", "из AnyX")]
        config.migrate_old_data(self.new, olds)
        self.assertEqual((self.new / "state.json").read_text("utf-8"), "из Animax")

    def test_falls_back_to_older_version(self):
        olds = [self.root / "Animax", self.old("AnyX", "из AnyX")]
        config.migrate_old_data(self.new, olds)
        self.assertEqual((self.new / "state.json").read_text("utf-8"), "из AnyX")

    def test_never_overwrites_own_data(self):
        self.new.mkdir()
        (self.new / "state.json").write_text("своё", "utf-8")
        config.migrate_old_data(self.new, [self.old("Animax", "из Animax")])
        self.assertEqual((self.new / "state.json").read_text("utf-8"), "своё")

    def test_window_profile_and_cache_are_not_copied(self):
        d = self.old("Animax", "{}")
        (d / "cache").mkdir()
        (d / "window").mkdir()
        config.migrate_old_data(self.new, [d])
        self.assertFalse((self.new / "cache").exists())
        self.assertFalse((self.new / "window").exists())


if __name__ == "__main__":
    unittest.main()
