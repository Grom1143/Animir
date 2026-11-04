"""Настройки движка окна: одни и те же для Edge --app и для своего окна на WebView2."""
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

os.environ["APPDATA"] = os.path.join(tempfile.gettempdir(), f"animir-test-{uuid.uuid4().hex[:8]}")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import windows  # noqa: E402


class EngineFlagsTest(unittest.TestCase):
    def test_video_starts_without_click(self):
        # автопереход к следующей серии: без этого флага видео ждёт клика
        with mock.patch.object(windows, "lite_mode", return_value=False):
            self.assertIn("--autoplay-policy=no-user-gesture-required", windows.engine_flags())

    def test_lite_mode_saves_memory(self):
        with mock.patch.object(windows, "lite_mode", return_value=True):
            flags = windows.engine_flags()
        self.assertIn("--disable-gpu", flags)
        self.assertIn("--renderer-process-limit=1", flags)

    def test_engine_flags_have_no_window_specifics(self):
        # адрес, профиль и размер у WebView2 задаются иначе — в общих флагах их быть не должно
        with mock.patch.object(windows, "lite_mode", return_value=False):
            flags = windows.engine_flags()
        self.assertFalse([f for f in flags if f.startswith(("--app=", "--user-data-dir=", "--window-size="))])

    def test_edge_window_keeps_its_flags(self):
        with mock.patch.object(windows, "lite_mode", return_value=False):
            flags = windows.edge_flags("http://127.0.0.1:8790/", "1400,880")
        self.assertIn("--app=http://127.0.0.1:8790/", flags)
        self.assertIn("--window-size=1400,880", flags)
        self.assertIn("--disable-extensions", flags)
        self.assertIn("--autoplay-policy=no-user-gesture-required", flags)


class PlayerWindowTest(unittest.TestCase):
    def test_own_window_instead_of_edge(self):
        opened = []
        with mock.patch.object(windows, "ON_OPEN", [opened.append]), \
                mock.patch.object(windows.subprocess, "Popen") as popen:
            self.assertTrue(windows.open_app_window("#/watch?id=1&w=1", 8790))
        self.assertEqual(opened, ["http://127.0.0.1:8790/#/watch?id=1&w=1"])
        popen.assert_not_called()

    def test_edge_when_no_own_window(self):
        with mock.patch.object(windows, "ON_OPEN", []), \
                mock.patch.object(windows, "find_edge", return_value="msedge.exe"), \
                mock.patch.object(windows.subprocess, "Popen") as popen:
            self.assertTrue(windows.open_app_window("#/watch?id=1&w=1", 8790))
        self.assertIn("--app=http://127.0.0.1:8790/#/watch?id=1&w=1", popen.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
