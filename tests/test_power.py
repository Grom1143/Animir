"""Экономия заряда: сервер должен уметь сказать, работает ли ноутбук от батареи."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import animir.sysinfo as sysinfo  # noqa: E402


class PowerTest(unittest.TestCase):
    def test_on_battery_returns_bool(self):
        self.assertIsInstance(sysinfo.on_battery(), bool)

    def test_sys_info_has_power_flag(self):
        # страница берёт on_battery из /api/sys, по нему включается режим экономии
        self.assertIn("on_battery", sysinfo.info())
        self.assertIsInstance(sysinfo.info()["on_battery"], bool)

    def test_no_battery_means_ac_power(self):
        """У стационарного ПК батареи нет: сетевое питание, а не «на батарее»."""
        self.assertFalse(sysinfo._from_status(255, sysinfo._BATTERY_NONE))
        self.assertFalse(sysinfo._from_status(1, 8))   # на зарядке
        self.assertTrue(sysinfo._from_status(0, 8))    # от батареи


if __name__ == "__main__":
    unittest.main()
